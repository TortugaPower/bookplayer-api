// Thin seam over the Stripe SDK: only the calls billing needs, typed minimally
// so tests inject a fake. The SDK is required lazily, so the API boots (and
// every non-billing route works) without STRIPE_SECRET_KEY set.

export interface StripeCheckoutSessionParams {
  // `payment` is a one-time charge (a tip); `subscription` everything else.
  mode: 'subscription' | 'payment';
  line_items: Array<{ price: string; quantity: number }>;
  // Both absent for a tip from someone who is not signed in.
  client_reference_id?: string;
  customer?: string;
  // Prefills (and fixes) the email Checkout asks for when there is no
  // customer, without creating one.
  customer_email?: string;
  success_url: string;
  cancel_url: string;
  allow_promotion_codes?: boolean;
  // `donate` labels the pay button "Donate".
  submit_type?: 'donate';
  // Unix seconds; Stripe accepts 30 minutes to 24 hours (the default).
  expires_at?: number;
  metadata?: Record<string, string>;
  subscription_data?: { metadata?: Record<string, string> };
  payment_intent_data?: { metadata?: Record<string, string> };
}

export interface StripeCustomer {
  id: string;
  email?: string | null;
  created: number;
  metadata?: Record<string, string>;
  subscriptions?: { data: Array<{ id: string; status: string }> };
}

// A subscription, reduced to what a plan change needs to reason about.
export interface StripeSubscription {
  id: string;
  status: string;
  // `app_user_id` on every subscription this API's Checkout creates.
  metadata?: Record<string, string>;
  // Set when a change is waiting on a payment that has not gone through.
  pending_update?: unknown | null;
  // Unix seconds. Only on API versions before `2025-03-31.basil`; the period
  // moved onto the items there. Read it through `periodEndOf`.
  current_period_end?: number;
  schedule?: string | null;
  items: {
    data: Array<{
      id: string;
      price: { id: string };
      current_period_end?: number;
    }>;
  };
}

export interface StripeSubscriptionUpdateParams {
  items: Array<{ id: string; price: string }>;
  proration_behavior: 'create_prorations' | 'always_invoice' | 'none';
  // `pending_if_incomplete` holds the change until the proration invoice is
  // paid. Stripe's default applies the new price first and lets the
  // subscription go past_due if the card fails, handing out Pro unpaid.
  payment_behavior?:
    | 'allow_incomplete'
    | 'pending_if_incomplete'
    | 'error_if_incomplete';
}

export interface StripeSchedulePhase {
  items: Array<{ price: string; quantity: number }>;
  start_date?: number | 'now';
  end_date?: number;
  proration_behavior?: 'create_prorations' | 'always_invoice' | 'none';
  // Copied from the subscription by `from_subscription`. Stripe unsets any of
  // these an update leaves out. Read back, tax rates and the payment method
  // may be objects; they are sent as ids.
  discounts?: Array<{
    coupon?: string | null;
    discount?: string | null;
    promotion_code?: string | null;
  }> | null;
  metadata?: Record<string, string> | null;
  default_tax_rates?: Array<string | { id: string }> | null;
  default_payment_method?: string | { id: string } | null;
}

export interface StripeSubscriptionSchedule {
  id: string;
  subscription?: string | null;
  phases: StripeSchedulePhase[];
}

// An upcoming invoice as previewed. Amounts are in the currency's minor unit.
export interface StripeInvoicePreview {
  currency: string;
  subtotal: number;
  total: number;
  amount_due: number;
  // Tax has moved field across API versions; all three shapes are read.
  total_taxes?: Array<{ amount: number }> | null;
  tax?: number | null;
  total_tax_amounts?: Array<{ amount: number }> | null;
  lines: { data: Array<{ description: string | null; amount: number }> };
}

export interface StripeInvoicePreviewParams {
  customer: string;
  subscription: string;
  subscription_details: {
    items: Array<{ id: string; price: string }>;
    proration_behavior: 'create_prorations' | 'always_invoice' | 'none';
  };
}

export interface StripeClient {
  // `idempotencyKey`: Stripe answers a repeat within 24 hours with the
  // customer the first call created, instead of a second one.
  createCustomer(
    params: { email?: string; metadata: Record<string, string> },
    options?: { idempotencyKey?: string },
  ): Promise<StripeCustomer>;
  createCheckoutSession(
    params: StripeCheckoutSessionParams,
  ): Promise<{ id: string; url: string | null }>;
  createPortalSession(params: {
    customer: string;
    return_url: string;
    configuration?: string;
  }): Promise<{ url: string }>;
  listCustomersByEmail(email: string): Promise<StripeCustomer[]>;
  // Customers tagged `metadata.app_user_id`, through Stripe's search, which
  // can lag a just-created customer by up to a minute.
  searchCustomersByAppUserId(appUserId: string): Promise<StripeCustomer[]>;
  listOpenCheckoutSessions(
    customerId: string,
  ): Promise<Array<{ id: string; mode: string }>>;
  expireCheckoutSession(id: string): Promise<void>;
  listSubscriptions(customerId: string): Promise<StripeSubscription[]>;
  updateSubscription(
    id: string,
    params: StripeSubscriptionUpdateParams,
  ): Promise<StripeSubscription>;
  createSchedule(subscriptionId: string): Promise<StripeSubscriptionSchedule>;
  updateSchedule(
    id: string,
    params: {
      phases: StripeSchedulePhase[];
      end_behavior: 'release' | 'cancel';
    },
  ): Promise<StripeSubscriptionSchedule>;
  releaseSchedule(id: string): Promise<{ id: string }>;
  getSchedule(id: string): Promise<StripeSubscriptionSchedule | null>;
  previewInvoice(
    params: StripeInvoicePreviewParams,
  ): Promise<StripeInvoicePreview>;
}

// When the period the customer has paid for runs out (Unix seconds). Stripe
// moved `current_period_end` onto the subscription items in `2025-03-31.basil`
// and the SDK speaks a later version, so the item is read first and the
// subscription field kept as a fallback for accounts pinned to older versions.
export function periodEndOf(subscription: StripeSubscription): number | null {
  const fromItem = subscription.items?.data?.[0]?.current_period_end;
  const value =
    typeof fromItem === 'number' ? fromItem : subscription.current_period_end;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Real client backed by the `stripe` npm package (required lazily).
export class StripeSdkClient implements StripeClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _stripe: any;

  constructor(secretKey: string, timeoutMs: number) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require('stripe');
    const Ctor = Stripe.default ?? Stripe;
    this._stripe = new Ctor(secretKey, {
      appInfo: { name: 'bookplayer-api' },
      // The SDK default is 80 s. Every call here happens while a request is
      // being answered, so an unreachable Stripe has to fail fast.
      timeout: timeoutMs,
    });
  }

  async createCustomer(
    params: { email?: string; metadata: Record<string, string> },
    options?: { idempotencyKey?: string },
  ): Promise<StripeCustomer> {
    return (await this._stripe.customers.create(
      params,
      options?.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : undefined,
    )) as StripeCustomer;
  }

  async createCheckoutSession(params: StripeCheckoutSessionParams) {
    const session = await this._stripe.checkout.sessions.create(params);
    return {
      id: session.id as string,
      url: (session.url ?? null) as string | null,
    };
  }

  async createPortalSession(params: {
    customer: string;
    return_url: string;
    configuration?: string;
  }) {
    const session = await this._stripe.billingPortal.sessions.create(params);
    return { url: session.url as string };
  }

  async listCustomersByEmail(email: string): Promise<StripeCustomer[]> {
    const res = await this._stripe.customers.list({
      email,
      limit: 10,
      expand: ['data.subscriptions'],
    });
    return (res.data ?? []) as StripeCustomer[];
  }

  async searchCustomersByAppUserId(
    appUserId: string,
  ): Promise<StripeCustomer[]> {
    const value = appUserId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const res = await this._stripe.customers.search({
      query: `metadata['app_user_id']:'${value}'`,
      limit: 10,
      expand: ['data.subscriptions'],
    });
    return (res.data ?? []) as StripeCustomer[];
  }

  async listOpenCheckoutSessions(customerId: string) {
    const res = await this._stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 20,
    });
    return (res.data ?? []).map((s: { id: string; mode: string }) => ({
      id: s.id,
      mode: s.mode,
    }));
  }

  async expireCheckoutSession(id: string): Promise<void> {
    await this._stripe.checkout.sessions.expire(id);
  }

  async listSubscriptions(customerId: string): Promise<StripeSubscription[]> {
    // `all`, not `active`: a past_due or unpaid subscription is still one the
    // customer is on, and selling them a second would bill them twice.
    const res = await this._stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });
    return (res.data ?? []) as StripeSubscription[];
  }

  async updateSubscription(
    id: string,
    params: StripeSubscriptionUpdateParams,
  ): Promise<StripeSubscription> {
    return (await this._stripe.subscriptions.update(
      id,
      params,
    )) as StripeSubscription;
  }

  async createSchedule(
    subscriptionId: string,
  ): Promise<StripeSubscriptionSchedule> {
    return (await this._stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    })) as StripeSubscriptionSchedule;
  }

  async updateSchedule(
    id: string,
    params: {
      phases: StripeSchedulePhase[];
      end_behavior: 'release' | 'cancel';
    },
  ): Promise<StripeSubscriptionSchedule> {
    return (await this._stripe.subscriptionSchedules.update(
      id,
      params,
    )) as StripeSubscriptionSchedule;
  }

  async releaseSchedule(id: string): Promise<{ id: string }> {
    return (await this._stripe.subscriptionSchedules.release(id)) as {
      id: string;
    };
  }

  async previewInvoice(
    params: StripeInvoicePreviewParams,
  ): Promise<StripeInvoicePreview> {
    return (await this._stripe.invoices.createPreview(
      params,
    )) as StripeInvoicePreview;
  }

  async getSchedule(id: string): Promise<StripeSubscriptionSchedule | null> {
    try {
      return (await this._stripe.subscriptionSchedules.retrieve(
        id,
      )) as StripeSubscriptionSchedule;
    } catch (err) {
      // A released or deleted schedule is a 404 and genuinely means "no
      // pending change". Anything else (network, rate limit) is not, and
      // swallowing it would send a downgrade on to create a second schedule.
      if (err?.statusCode === 404 || err?.code === 'resource_missing')
        return null;
      throw err;
    }
  }
}

// null when STRIPE_SECRET_KEY is not set: the billing routes then answer 503
// BILLING_UNAVAILABLE, and the `stripe` package is never loaded.
export function createStripeClient(
  secretKey: string | undefined = process.env.STRIPE_SECRET_KEY,
  timeoutMs: number = Number(process.env.STRIPE_TIMEOUT_MS) || 8000,
): StripeClient | null {
  return secretKey ? new StripeSdkClient(secretKey, timeoutMs) : null;
}
