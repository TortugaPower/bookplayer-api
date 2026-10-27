import { ZodType, ZodTypeDef } from 'zod';
import { logger } from './LoggerService';
import { SubscriptionService } from './SubscriptionService';
import { UserDB } from './db/UserDB';
import {
  createStripeClient,
  periodEndOf,
  StripeClient,
  StripeCustomer,
  StripeInvoicePreview,
  StripeSubscription,
} from './StripeClient';
import { ApiError, ApiErrorCode } from '../types/apiError';
import {
  SubscriptionState,
  SubscriptionTierEnum,
  SubscriptionUser,
} from '../types/user';
import {
  BillingPlan,
  billingPlanSchema,
  BillingTip,
  billingTipSchema,
} from '../validation/billing';

export interface BillingConfig {
  // STRIPE_PLANS, parsed; invalid entries are dropped with a warning.
  plans: unknown[];
  // STRIPE_TIPS, the same way. Optional: no tips, an empty catalog.
  tips?: unknown[];
  // BILLING_RETURN_ORIGINS: allowed origins (`https://web.bookplayer.app`) or
  // schemes (`bookplayer:`) for success/cancel/return URLs.
  returnOrigins: string[];
  // STRIPE_PORTAL_CONFIGURATION_ID: optional Customer Portal configuration.
  portalConfigurationId?: string;
  // Development only: no RevenueCat v2 credentials, so checkout skips the
  // App Store / Google Play entitlement check instead of failing closed.
  skipStoreEntitlementCheck?: boolean;
}

export interface PlanChange {
  plan_code: string;
  effective: 'now' | 'period_end';
  // When a downgrade takes over (ISO 8601); null for an upgrade, which is
  // immediate, or if Stripe reported no period end.
  effective_at: string | null;
}

export interface PlanChangePreview extends PlanChange {
  currency: string;
  lines: Array<{ description: string; amount: number }>;
  subtotal: number;
  tax: number;
  total: number;
  amount_due: number;
}

// Entitlements a web purchase would duplicate. `plus` is a different product
// line and does not block buying Pro or Lite on the web.
const BLOCKING_ENTITLEMENTS: string[] = [
  SubscriptionTierEnum.PRO,
  SubscriptionTierEnum.LITE,
];

// Stripe statuses that are history. Everything else, past_due included, is a
// subscription the customer is still on and must not be sold a second time.
const DEAD_STATUSES = new Set(['canceled', 'incomplete_expired']);

// Which way a plan change goes. The tier decides first, so Lite yearly -> Pro
// monthly is an upgrade although it costs less per charge. Within a tier, a
// longer interval is the upgrade (monthly -> yearly is paid now); only two
// prices of one tier and interval fall back to the amount. A plan_code missing
// here is compared like a same-tier plan.
const TIER_RANK: Record<string, number> = {
  [SubscriptionTierEnum.LITE]: 1,
  [SubscriptionTierEnum.PRO]: 2,
};
const INTERVAL_DAYS: Record<BillingPlan['interval'], number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export function isPlanUpgrade(
  current: BillingPlan | null,
  target: BillingPlan,
): boolean {
  // An unknown current price is treated as an upgrade: charging now is
  // recoverable, a change the customer did not expect at renewal is not.
  if (!current) return true;
  const from = TIER_RANK[current.plan_code];
  const to = TIER_RANK[target.plan_code];
  if (from !== undefined && to !== undefined && from !== to) return to > from;
  if (current.interval !== target.interval) {
    return INTERVAL_DAYS[target.interval] > INTERVAL_DAYS[current.interval];
  }
  return target.amount > current.amount;
}

const unavailable = (message: string) =>
  new ApiError(ApiErrorCode.BILLING_UNAVAILABLE, 503, message);

// Web subscriptions through Stripe Checkout and the Customer Portal.
//
// Stripe is a store in RevenueCat (the RevenueCat Stripe app). The Checkout
// Session carries `client_reference_id` = the account's RevenueCat App User ID
// (`users.external_id`, the `revenuecat_id` every login returns and the id the
// apps log in to RevenueCat with), RevenueCat attaches the Stripe subscription
// to that customer, and the existing RevenueCat webhook and v2 lookups grant
// the `pro` / `lite` entitlement everywhere. This service stores nothing.
export class BillingService {
  private readonly _logger = logger;
  private readonly _plans: BillingPlan[];
  private readonly _tips: BillingTip[];
  private readonly _allowedOrigins = new Set<string>();
  private readonly _allowedSchemes = new Set<string>();

  constructor(
    private _stripe: StripeClient | null = createStripeClient(),
    private _config: BillingConfig = billingConfigFromEnv(),
    private _subscriptionService: SubscriptionService = new SubscriptionService(),
    private _userDB: UserDB = new UserDB(),
  ) {
    this._plans = parsePlans(_config.plans);
    this._tips = parseTips(_config.tips ?? []);
    for (const entry of _config.returnOrigins) {
      const value = entry.trim().toLowerCase();
      if (!value) continue;
      if (/^[a-z][a-z0-9+.-]*:$/.test(value)) this._allowedSchemes.add(value);
      else this._allowedOrigins.add(value.replace(/\/+$/, ''));
    }
  }

  listPlans(): BillingPlan[] {
    return this._plans;
  }

  findPlan(priceId: string): BillingPlan | null {
    return this._plans.find((p) => p.price_id === priceId) ?? null;
  }

  listTips(): BillingTip[] {
    return this._tips;
  }

  isAllowedReturnUrl(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    const protocol = url.protocol.toLowerCase();
    if (this._allowedSchemes.has(protocol)) return true;
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    if (this._allowedOrigins.has(`${protocol}//${url.host.toLowerCase()}`))
      return true;
    // Plain http only for a local web client, and never in production.
    if (protocol === 'http:' && process.env.NODE_ENV !== 'production') {
      const host = url.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
  }

  // A subscription Checkout Session for a first purchase; returns the hosted
  // page URL. Plan changes go through `changePlan`, never a second Checkout.
  async createCheckout(
    sessionUser: { id_user: number },
    input: { priceId: string; successUrl: string; cancelUrl: string },
  ): Promise<{ url: string; sessionId: string }> {
    const stripe = this._requireStripe();
    const plan = this.findPlan(input.priceId);
    if (!plan)
      throw new ApiError(ApiErrorCode.PRICE_INVALID, 400, 'Unknown price_id');
    this._requireReturnUrls(input);
    const account = await this._account(sessionUser);

    // Fail closed throughout: a guard that cannot confirm the account's state
    // refuses the purchase rather than risk billing it twice.
    const existing = await this._findCustomer(account).catch((err) => {
      this._logStripeFailure('BillingService.createCheckout', account, err);
      throw unavailable(
        'Could not confirm your subscription status. Try again in a moment.',
      );
    });
    if (existing) {
      const live = await this._liveSubscription(existing.id).catch((err) => {
        this._logStripeFailure('BillingService.createCheckout', account, err);
        throw unavailable(
          'Could not confirm your subscription status. Try again in a moment.',
        );
      });
      if (live) {
        throw new ApiError(
          ApiErrorCode.ALREADY_SUBSCRIBED,
          409,
          'This account already has an active web subscription. Use change plan instead.',
        );
      }
    }

    // A pro/lite entitlement from the App Store or Google Play is the same
    // product: selling it again on the web would bill them twice.
    const rc = this._config.skipStoreEntitlementCheck
      ? this._skippedStoreCheck(account)
      : await this._subscriptionService.fetchLiveEntitlements(
          account.external_id,
        );
    if (!rc) {
      throw unavailable(
        'Could not confirm your subscription status. Try again in a moment.',
      );
    }
    if (
      rc.active &&
      rc.subscriptions.some((tier) => BLOCKING_ENTITLEMENTS.includes(tier))
    ) {
      throw new ApiError(
        ApiErrorCode.ALREADY_SUBSCRIBED,
        409,
        'This account already has an active subscription. Manage it where you bought it.',
      );
    }

    // Create the customer up front, tagged with the App User ID, rather than
    // letting Checkout create an untagged one: the tag is what lets
    // `_findCustomer` tell this account's customer from another account's on
    // the same email.
    const customer =
      existing ??
      (await stripe.createCustomer({
        ...(account.email ? { email: account.email } : {}),
        metadata: { app_user_id: account.external_id },
      }));

    const metadata = {
      app_user_id: account.external_id,
      plan_code: plan.plan_code,
    };
    const session = await stripe.createCheckoutSession({
      mode: 'subscription',
      line_items: [{ price: plan.price_id, quantity: 1 }],
      // RevenueCat's Stripe app maps the purchase to this App User ID.
      client_reference_id: account.external_id,
      customer: customer.id,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    });
    if (!session.url) throw unavailable('Stripe did not return a checkout URL');

    this._logger.log({
      origin: 'BillingService.createCheckout',
      message: 'checkout session created',
      data: {
        id_user: account.id_user,
        plan: plan.plan_code,
        session_id: session.id,
        reused_customer: Boolean(existing),
      },
    });
    return { url: session.url, sessionId: session.id };
  }

  // A one-time Checkout Session for a tip. Anyone may tip, signed in or not,
  // and on any plan: a tip buys nothing, so none of checkout's guards apply.
  // A signed-in tipper's App User ID goes on the session so RevenueCat can
  // record the purchase on their customer; no Stripe customer is created here.
  async createTip(
    sessionUser: { id_user: number } | null,
    input: { priceId: string; successUrl: string; cancelUrl: string },
  ): Promise<{ url: string; sessionId: string }> {
    const stripe = this._requireStripe();
    const tip = this._tips.find((t) => t.price_id === input.priceId);
    if (!tip)
      throw new ApiError(ApiErrorCode.PRICE_INVALID, 400, 'Unknown price_id');
    this._requireReturnUrls(input);

    // An account that cannot be loaded still tips, just unattributed.
    const account = sessionUser
      ? await this._userDB.getActiveUserById(sessionUser.id_user)
      : null;
    const appUserId = account?.external_id || null;
    const metadata: Record<string, string> = {
      tip_code: tip.tip_code,
      ...(appUserId ? { app_user_id: appUserId } : {}),
    };
    const session = await stripe.createCheckoutSession({
      mode: 'payment',
      submit_type: 'donate',
      line_items: [{ price: tip.price_id, quantity: 1 }],
      ...(appUserId ? { client_reference_id: appUserId } : {}),
      // Checkout always asks a payment for an email (the receipt goes there);
      // a signed-in tipper's is known, so they aren't asked for it.
      ...(appUserId && account?.email ? { customer_email: account.email } : {}),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      payment_intent_data: { metadata },
    });
    if (!session.url) throw unavailable('Stripe did not return a checkout URL');

    this._logger.log({
      origin: 'BillingService.createTip',
      message: 'tip checkout session created',
      data: {
        id_user: sessionUser?.id_user ?? null,
        attributed: Boolean(appUserId),
        tip: tip.tip_code,
        session_id: session.id,
      },
    });
    return { url: session.url, sessionId: session.id };
  }

  // Move an existing web subscription to another plan. Deliberately
  // asymmetric, as the app stores are:
  //  - Up (Lite -> Pro, or monthly -> yearly): applied now and invoiced for
  //    the rest of the period (`always_invoice`), held until the charge is paid.
  //  - Down (Pro -> Lite, or yearly -> monthly): a subscription schedule
  //    switches at the end of the period already paid for, with no proration,
  //    so nothing is refunded or taken away early. The Customer Portal cannot
  //    do this across products.
  // Direction is `isPlanUpgrade`: tier first, then interval, then amount.
  async changePlan(
    sessionUser: { id_user: number },
    input: { priceId: string },
  ): Promise<PlanChange> {
    const stripe = this._requireStripe();
    const account = await this._account(sessionUser);

    // Repair first, and only here, never from a preview: an upgrade that the
    // bank cleared late leaves the subscription on the new price with an old
    // downgrade phase still attached, and `_resolveChange` would refuse that
    // state with ALREADY_ON_PLAN before anything could clear it.
    const existing = await this._liveSubscriptionFor(account);
    if (existing?.schedule && existing.items.data[0]?.price?.id) {
      await this._releaseStaleSchedule(
        account,
        existing,
        existing.items.data[0].price.id,
      );
    }

    const { target, current, subscription, item, isUpgrade } =
      await this._resolveChange(account, input.priceId);

    if (isUpgrade) {
      const updated = await stripe.updateSubscription(subscription.id, {
        items: [{ id: item.id, price: target.price_id }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
      });
      if (updated?.pending_update) {
        this._logger.log(
          {
            origin: 'BillingService.changePlan',
            message: 'upgrade is waiting on payment',
            data: { id_user: account.id_user, to: target.plan_code },
          },
          'warn',
        );
        throw new ApiError(
          ApiErrorCode.UPGRADE_PAYMENT_PENDING,
          402,
          'Your bank has not confirmed the charge yet. The new plan starts as soon as it does.',
        );
      }

      // Only once the upgrade is paid: a downgrade scheduled earlier would
      // otherwise move them off the plan they just bought at the period end.
      if (subscription.schedule) {
        try {
          await stripe.releaseSchedule(subscription.schedule);
        } catch (err) {
          // Paid and applied, so this is the lesser problem, and the next
          // changePlan reaches `_releaseStaleSchedule` and clears it.
          this._logger.log(
            {
              origin: 'BillingService.changePlan',
              message: `could not release the pending schedule after upgrading: ${err.message}`,
              data: {
                id_user: account.id_user,
                schedule: subscription.schedule,
              },
            },
            'error',
          );
        }
      }
      this._logger.log({
        origin: 'BillingService.changePlan',
        message: 'plan upgraded',
        data: {
          id_user: account.id_user,
          from: current?.plan_code ?? item.price.id,
          to: target.plan_code,
        },
      });
      return {
        plan_code: target.plan_code,
        effective: 'now',
        effective_at: null,
      };
    }

    // Downgrade. `from_subscription` copies the live subscription into a
    // schedule whose first phase is the period in flight; a second phase on
    // the new price defers the change, and `release` hands the
    // subscription back to normal billing afterwards.
    const schedule = subscription.schedule
      ? (await stripe.getSchedule(subscription.schedule)) ??
        (await stripe.createSchedule(subscription.id))
      : await stripe.createSchedule(subscription.id);
    const periodEnd = periodEndOf(subscription);

    // Stripe unsets what an update omits, so the current phase is re-sent as
    // it stands, start_date included.
    const currentPhase = schedule.phases?.[0];
    await stripe.updateSchedule(schedule.id, {
      phases: [
        {
          items: [{ price: item.price.id, quantity: 1 }],
          ...(currentPhase?.start_date !== undefined
            ? { start_date: currentPhase.start_date }
            : {}),
          end_date: currentPhase?.end_date ?? periodEnd ?? undefined,
        },
        {
          items: [{ price: target.price_id, quantity: 1 }],
          proration_behavior: 'none',
        },
      ],
      end_behavior: 'release',
    });

    this._logger.log({
      origin: 'BillingService.changePlan',
      message: 'plan downgrade scheduled',
      data: {
        id_user: account.id_user,
        from: current?.plan_code ?? item.price.id,
        to: target.plan_code,
        effective_at: periodEnd,
      },
    });
    return {
      plan_code: target.plan_code,
      effective: 'period_end',
      effective_at: isoOrNull(periodEnd),
    };
  }

  // What `changePlan` would cost, without doing it: the same resolution and
  // direction rule, then Stripe's own invoice preview with the proration the
  // real call would apply. A downgrade previews the next period at the new
  // price (charged on `effective_at`, not today).
  async previewChange(
    sessionUser: { id_user: number },
    input: { priceId: string },
  ): Promise<PlanChangePreview> {
    const stripe = this._requireStripe();
    const account = await this._account(sessionUser);
    const { target, subscription, item, isUpgrade, customerId } =
      await this._resolveChange(account, input.priceId);

    const preview = await stripe.previewInvoice({
      customer: customerId,
      subscription: subscription.id,
      subscription_details: {
        items: [{ id: item.id, price: target.price_id }],
        proration_behavior: isUpgrade ? 'always_invoice' : 'none',
      },
    });

    return {
      plan_code: target.plan_code,
      effective: isUpgrade ? 'now' : 'period_end',
      effective_at: isUpgrade ? null : isoOrNull(periodEndOf(subscription)),
      ...presentPreview(preview),
    };
  }

  // A Customer Portal session for the account's Stripe customer.
  async createPortal(
    sessionUser: { id_user: number },
    input: { returnUrl: string },
  ): Promise<{ url: string }> {
    const stripe = this._requireStripe();
    if (!this.isAllowedReturnUrl(input.returnUrl)) {
      throw new ApiError(
        ApiErrorCode.RETURN_URL_NOT_ALLOWED,
        400,
        'return_url must point to an allowed origin',
      );
    }
    const account = await this._account(sessionUser);
    const customer = await this._findCustomer(account);
    if (!customer) {
      throw new ApiError(
        ApiErrorCode.BILLING_NO_CUSTOMER,
        404,
        'No web subscription for this account. Store purchases are managed in that store.',
      );
    }
    const session = await stripe.createPortalSession({
      customer: customer.id,
      return_url: input.returnUrl,
      ...(this._config.portalConfigurationId
        ? { configuration: this._config.portalConfigurationId }
        : {}),
    });
    this._logger.log({
      origin: 'BillingService.createPortal',
      message: 'portal session created',
      data: { id_user: account.id_user, customer: customer.id },
    });
    return { url: session.url };
  }

  private _skippedStoreCheck(account: SubscriptionUser): SubscriptionState {
    this._logger.log(
      {
        origin: 'BillingService.createCheckout',
        message:
          'store entitlement check skipped: REVENUECAT_PROJECT_ID / REVENUECAT_API_V2_KEY not set (development only)',
        data: { id_user: account.id_user },
      },
      'warn',
    );
    return { active: false, verified: 'rc', subscriptions: [] };
  }

  // Shared by the preview and the real change so they can never disagree on
  // which plan, which subscription line, or which direction.
  private async _resolveChange(
    account: SubscriptionUser,
    priceId: string,
  ): Promise<{
    target: BillingPlan;
    current: BillingPlan | null;
    customerId: string;
    subscription: StripeSubscription;
    item: { id: string; price: { id: string } };
    isUpgrade: boolean;
  }> {
    const target = this.findPlan(priceId);
    if (!target)
      throw new ApiError(ApiErrorCode.PRICE_INVALID, 400, 'Unknown price_id');

    const customer = await this._findCustomer(account);
    if (!customer) {
      throw new ApiError(
        ApiErrorCode.BILLING_NO_CUSTOMER,
        404,
        'No web subscription for this account. Store purchases are managed in that store.',
      );
    }
    const subscription = await this._liveSubscription(customer.id);
    if (!subscription) {
      throw new ApiError(
        ApiErrorCode.NO_SUBSCRIPTION,
        404,
        'This account has no active web subscription to change.',
      );
    }
    const item = subscription.items.data[0];
    if (!item) throw unavailable('The subscription has no items to change');
    if (item.price.id === target.price_id) {
      // No repair here: a preview that cancelled a scheduled downgrade would
      // be worse than the problem. `changePlan` repairs before calling this.
      throw new ApiError(
        ApiErrorCode.ALREADY_ON_PLAN,
        409,
        `This account is already on ${target.plan_code}.`,
      );
    }
    const current = this.findPlan(item.price.id);
    return {
      target,
      current,
      customerId: customer.id,
      subscription,
      item,
      isUpgrade: isPlanUpgrade(current, target),
    };
  }

  // The live subscription, for the stale-schedule repair only; the resolve
  // that follows reports any real problem.
  private async _liveSubscriptionFor(
    account: SubscriptionUser,
  ): Promise<StripeSubscription | null> {
    try {
      const customer = await this._findCustomer(account);
      return customer ? await this._liveSubscription(customer.id) : null;
    } catch {
      return null;
    }
  }

  // Drop a schedule whose first phase starts from a price the subscription
  // is no longer on: what an upgrade the bank cleared late leaves behind.
  // A schedule that starts from the live price is a downgrade the customer
  // meant to keep, and stays. Best-effort: failing leaves the state as found.
  private async _releaseStaleSchedule(
    account: SubscriptionUser,
    subscription: StripeSubscription,
    livePriceId: string,
  ): Promise<void> {
    const stripe = this._requireStripe();
    try {
      const schedule = await stripe.getSchedule(subscription.schedule);
      const startsFrom = schedule?.phases?.[0]?.items?.[0]?.price ?? null;
      if (startsFrom == null || startsFrom === livePriceId) return;
      await stripe.releaseSchedule(subscription.schedule);
      this._logger.log({
        origin: 'BillingService._releaseStaleSchedule',
        message: 'released a schedule that disagreed with the live plan',
        data: {
          id_user: account.id_user,
          schedule: subscription.schedule,
          livePriceId,
        },
      });
    } catch (err) {
      this._logger.log(
        {
          origin: 'BillingService._releaseStaleSchedule',
          message: err.message,
          data: { id_user: account.id_user, schedule: subscription.schedule },
        },
        'error',
      );
    }
  }

  private async _liveSubscription(
    customerId: string,
  ): Promise<StripeSubscription | null> {
    const subscriptions = await this._requireStripe().listSubscriptions(
      customerId,
    );
    return subscriptions.find((s) => !DEAD_STATUSES.has(s.status)) ?? null;
  }

  // The account's Stripe customer among those sharing its email: one tagged
  // with its App User ID first, then one with a subscription, then the
  // newest. A customer tagged with a different App User ID belongs to another
  // account (e.g. a deleted one on the same email) and is never used.
  private async _findCustomer(
    account: SubscriptionUser,
  ): Promise<StripeCustomer | null> {
    if (!account.email) return null;
    const candidates = (
      await this._requireStripe().listCustomersByEmail(account.email)
    ).filter(
      (c) =>
        !c.metadata?.app_user_id ||
        c.metadata.app_user_id === account.external_id,
    );
    if (candidates.length === 0) return null;
    const tagged = candidates.find(
      (c) => c.metadata?.app_user_id === account.external_id,
    );
    if (tagged) return tagged;
    const newestFirst = [...candidates].sort((a, b) => b.created - a.created);
    return (
      newestFirst.find((c) => (c.subscriptions?.data?.length ?? 0) > 0) ??
      newestFirst[0]
    );
  }

  // The row, not the JWT: see UserDB.getActiveUserById.
  private async _account(sessionUser: {
    id_user: number;
  }): Promise<SubscriptionUser> {
    const account = await this._userDB.getActiveUserById(sessionUser.id_user);
    if (!account?.external_id) {
      throw unavailable('Could not load the account. Try again in a moment.');
    }
    return account;
  }

  // Checkout's success and cancel URLs, both on BILLING_RETURN_ORIGINS.
  private _requireReturnUrls(input: {
    successUrl: string;
    cancelUrl: string;
  }): void {
    for (const [field, value] of [
      ['success_url', input.successUrl],
      ['cancel_url', input.cancelUrl],
    ] as const) {
      if (!this.isAllowedReturnUrl(value)) {
        throw new ApiError(
          ApiErrorCode.RETURN_URL_NOT_ALLOWED,
          400,
          `${field} must point to an allowed origin`,
        );
      }
    }
  }

  private _requireStripe(): StripeClient {
    if (!this._stripe) throw unavailable('Billing is not configured');
    return this._stripe;
  }

  private _logStripeFailure(
    origin: string,
    account: SubscriptionUser,
    err: Error,
  ): void {
    this._logger.log(
      { origin, message: err?.message, data: { id_user: account.id_user } },
      'error',
    );
  }
}

// STRIPE_PLANS is a JSON array of plans; anything unparsable is an empty
// catalog (logged), so a typo there takes billing down, not the API.
export function billingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BillingConfig {
  return {
    plans: jsonArrayFromEnv(env, 'STRIPE_PLANS'),
    tips: jsonArrayFromEnv(env, 'STRIPE_TIPS'),
    returnOrigins: (env.BILLING_RETURN_ORIGINS || '').split(','),
    portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
    skipStoreEntitlementCheck:
      env.NODE_ENV !== 'production' &&
      (!env.REVENUECAT_PROJECT_ID || !env.REVENUECAT_API_V2_KEY),
  };
}

// A malformed value is an empty catalog, logged, never a crash.
function jsonArrayFromEnv(env: NodeJS.ProcessEnv, name: string): unknown[] {
  if (!env[name]) return [];
  try {
    const parsed = JSON.parse(env[name] as string);
    if (!Array.isArray(parsed)) throw new Error('not a JSON array');
    return parsed;
  } catch (err) {
    logger.log(
      {
        origin: 'billingConfigFromEnv',
        message: `invalid ${name}: ${err.message}`,
      },
      'error',
    );
    return [];
  }
}

function parseCatalog<T>(
  raw: unknown[],
  schema: ZodType<T, ZodTypeDef, unknown>,
  name: string,
  origin: string,
): T[] {
  const entries: T[] = [];
  for (const entry of raw) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) {
      entries.push(parsed.data);
    } else {
      logger.log(
        {
          origin,
          message: `ignoring invalid ${name} entry`,
          data: { issues: parsed.error.issues.map((i) => i.path.join('.')) },
        },
        'warn',
      );
    }
  }
  return entries;
}

export function parsePlans(raw: unknown[]): BillingPlan[] {
  return parseCatalog(
    raw,
    billingPlanSchema,
    'STRIPE_PLANS',
    'BillingService.parsePlans',
  );
}

export function parseTips(raw: unknown[]): BillingTip[] {
  return parseCatalog(
    raw,
    billingTipSchema,
    'STRIPE_TIPS',
    'BillingService.parseTips',
  );
}

const isoOrNull = (unixSeconds: number | null): string | null =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

// Stripe's preview in the catalog's units. Stripe amounts are minor units
// (499); the catalog and this response are major units (4.99).
function presentPreview(
  preview: StripeInvoicePreview,
): Omit<PlanChangePreview, 'plan_code' | 'effective' | 'effective_at'> {
  const major = (minor: number): number => Math.round(minor) / 100;
  const taxMinor =
    preview.total_taxes?.reduce((sum, t) => sum + (t.amount ?? 0), 0) ??
    preview.total_tax_amounts?.reduce((sum, t) => sum + (t.amount ?? 0), 0) ??
    preview.tax ??
    0;
  return {
    currency: String(preview.currency ?? 'usd').toUpperCase(),
    lines: (preview.lines?.data ?? []).map((line) => ({
      description: line.description ?? '',
      amount: major(line.amount ?? 0),
    })),
    subtotal: major(preview.subtotal ?? 0),
    tax: major(taxMinor),
    total: major(preview.total ?? 0),
    // What they pay now: total minus any credit balance Stripe applies.
    amount_due: major(preview.amount_due ?? preview.total ?? 0),
  };
}
