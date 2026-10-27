import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  BillingService,
  billingConfigFromEnv,
  isPlanUpgrade,
  parsePlans,
  parseTips,
} from '../../services/BillingService';
import {
  StripeCheckoutSessionParams,
  StripeClient,
  StripeCustomer,
  StripeInvoicePreview,
  StripeInvoicePreviewParams,
  StripeSchedulePhase,
  StripeSubscription,
  StripeSubscriptionUpdateParams,
} from '../../services/StripeClient';
import { ApiError } from '../../types/apiError';
import { SubscriptionState } from '../../types/user';
import { mockLoggerService } from '../setup';

const PLANS = [
  {
    price_id: 'price_pro_year',
    plan_code: 'pro',
    name: 'BookPlayer Pro (Web)',
    amount: 49.99,
    currency: 'usd',
    interval: 'year',
  },
  {
    price_id: 'price_lite_year',
    plan_code: 'lite',
    name: 'BookPlayer Lite (Web)',
    amount: 19.99,
    currency: 'USD',
    interval: 'year',
  },
  {
    price_id: 'price_pro_month',
    plan_code: 'pro',
    name: 'BookPlayer Pro (Web)',
    amount: 4.99,
    currency: 'USD',
    interval: 'month',
  },
  {
    price_id: 'price_lite_month',
    plan_code: 'lite',
    name: 'BookPlayer Lite (Web)',
    amount: 1.99,
    currency: 'USD',
    interval: 'month',
  },
  { price_id: 'broken', name: 'missing fields' },
];

const TIPS = [
  {
    price_id: 'price_tip_kind',
    tip_code: 'kind',
    name: 'Kind tip',
    amount: 1.99,
    currency: 'usd',
  },
  { price_id: 'price_tip_broken', tip_code: 'nameless' },
];

// Stripe speaks minor units; the catalog speaks major ones.
const PREVIEW: StripeInvoicePreview = {
  currency: 'usd',
  subtotal: 300,
  total: 330,
  amount_due: 330,
  total_taxes: [{ amount: 30 }],
  lines: {
    data: [
      { description: 'Unused time on BookPlayer Lite (Web)', amount: -199 },
      { description: 'BookPlayer Pro (Web)', amount: 499 },
    ],
  },
};

// Unix seconds, far enough out to read as "the period they paid for".
const PERIOD_END = 1_800_000_000;

const ACCOUNT = {
  id_user: 7,
  email: 'reader@example.com',
  external_id: 'rc-app-user-7',
};
const SESSION_USER = {
  id_user: 7,
  email: 'jwt-email@example.com',
  external_id: 'stale',
};
const CUSTOMER: StripeCustomer = {
  id: 'cus_1',
  email: ACCOUNT.email,
  created: 1,
  metadata: { app_user_id: ACCOUNT.external_id },
};
const URLS = {
  successUrl:
    'https://web.bookplayer.test/billing/success?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://web.bookplayer.test/billing',
};

const subscription = (
  priceId: string,
  over: Partial<StripeSubscription> = {},
): StripeSubscription => ({
  id: 'sub_1',
  status: 'active',
  current_period_end: PERIOD_END,
  items: { data: [{ id: 'si_1', price: { id: priceId } }] },
  ...over,
});

function fakeStripe(
  customers: StripeCustomer[] = [],
  subscriptions: StripeSubscription[] = [],
  schedules: Record<
    string,
    { id: string; phases: StripeSchedulePhase[] } | null
  > = {},
  preview: StripeInvoicePreview = PREVIEW,
) {
  const calls = {
    customersCreated: [] as Array<{
      email?: string;
      metadata: Record<string, string>;
    }>,
    checkout: [] as StripeCheckoutSessionParams[],
    portal: [] as Array<{
      customer: string;
      return_url: string;
      configuration?: string;
    }>,
    lookups: [] as string[],
    updates: [] as Array<{
      id: string;
      params: StripeSubscriptionUpdateParams;
    }>,
    schedulesCreated: [] as string[],
    schedulePhases: [] as Array<{
      id: string;
      phases: StripeSchedulePhase[];
      end_behavior: string;
    }>,
    released: [] as string[],
    previews: [] as StripeInvoicePreviewParams[],
  };
  const client: StripeClient = {
    async createCustomer(params) {
      calls.customersCreated.push(params);
      return { id: 'cus_new', created: 2, metadata: params.metadata };
    },
    async listSubscriptions() {
      return subscriptions;
    },
    async updateSubscription(id, params) {
      calls.updates.push({ id, params });
      return subscription(params.items[0].price);
    },
    async createSchedule(subscriptionId) {
      calls.schedulesCreated.push(subscriptionId);
      return { id: 'sub_sched_1', subscription: subscriptionId, phases: [] };
    },
    async updateSchedule(id, params) {
      calls.schedulePhases.push({
        id,
        phases: params.phases,
        end_behavior: params.end_behavior,
      });
      return { id, phases: params.phases };
    },
    async releaseSchedule(id) {
      calls.released.push(id);
      return { id };
    },
    async getSchedule(id) {
      return schedules[id] ?? null;
    },
    async previewInvoice(params) {
      calls.previews.push(params);
      return preview;
    },
    async createCheckoutSession(params) {
      calls.checkout.push(params);
      return {
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      };
    },
    async createPortalSession(params) {
      calls.portal.push(params);
      return { url: 'https://billing.stripe.com/p/session/bps_1' };
    },
    async listCustomersByEmail(email) {
      calls.lookups.push(email);
      return customers;
    },
  };
  return { client, calls };
}

// RevenueCat's live answer for the account; null = RC unreachable.
let rcState: SubscriptionState | null;
const rcLookups: string[] = [];

function service(
  client: StripeClient | null,
  extra: Partial<{
    returnOrigins: string[];
    portalConfigurationId: string;
    skipStoreEntitlementCheck: boolean;
  }> = {},
  account: typeof ACCOUNT | null = ACCOUNT,
): BillingService {
  const subscriptionService = {
    fetchLiveEntitlements: async (externalId: string) => {
      rcLookups.push(externalId);
      return rcState;
    },
  };
  const userDB = { getActiveUserById: async () => account };
  const s = new BillingService(
    client,
    {
      plans: PLANS,
      tips: TIPS,
      returnOrigins: extra.returnOrigins ?? [
        'https://web.bookplayer.test',
        'bookplayer:',
      ],
      portalConfigurationId: extra.portalConfigurationId,
      skipStoreEntitlementCheck: extra.skipStoreEntitlementCheck,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscriptionService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userDB as any,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (s as any)._logger = mockLoggerService;
  return s;
}

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (err) {
    return err instanceof ApiError
      ? `${err.statusCode} ${err.code}`
      : `THREW ${err.message}`;
  }
};

beforeEach(() => {
  rcState = { active: false, verified: 'rc', subscriptions: [] };
  rcLookups.length = 0;
});

describe('BillingService catalog and URLs', () => {
  it('parsePlans keeps valid entries (currency upper-cased) and drops invalid ones', () => {
    const plans = parsePlans(PLANS);
    expect(plans).toHaveLength(4);
    expect(plans[0].currency).toBe('USD');
    expect(plans.map((p) => p.plan_code)).toEqual([
      'pro',
      'lite',
      'pro',
      'lite',
    ]);
  });

  it('reads STRIPE_PLANS from env, and a malformed value is an empty catalog, not a crash', () => {
    const config = billingConfigFromEnv({
      STRIPE_PLANS: JSON.stringify(PLANS.slice(0, 1)),
      BILLING_RETURN_ORIGINS: 'https://web.bookplayer.test, bookplayer:',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_1',
    });
    expect(config.plans).toHaveLength(1);
    expect(config.portalConfigurationId).toBe('bpc_1');
    expect(billingConfigFromEnv({ STRIPE_PLANS: '{not json' }).plans).toEqual(
      [],
    );
    expect(billingConfigFromEnv({ STRIPE_PLANS: '{"a":1}' }).plans).toEqual([]);
    expect(billingConfigFromEnv({}).plans).toEqual([]);
  });

  it('return URL allow-list: configured origins and schemes, localhost only outside production', () => {
    const s = service(null);
    expect(
      s.isAllowedReturnUrl('https://web.bookplayer.test/billing?x=1'),
    ).toBe(true);
    expect(s.isAllowedReturnUrl('https://WEB.bookplayer.test/')).toBe(true);
    expect(s.isAllowedReturnUrl('bookplayer://billing/success')).toBe(true);
    expect(s.isAllowedReturnUrl('https://evil.example.com/')).toBe(false);
    expect(s.isAllowedReturnUrl('https://web.bookplayer.test.evil.com/')).toBe(
      false,
    );
    expect(s.isAllowedReturnUrl('javascript:alert(1)')).toBe(false);
    expect(s.isAllowedReturnUrl('not a url')).toBe(false);
    expect(s.isAllowedReturnUrl('http://localhost:5173/billing')).toBe(true);

    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(s.isAllowedReturnUrl('http://localhost:5173/billing')).toBe(false);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('BillingService.createCheckout', () => {
  it('builds a subscription session tied to the RevenueCat App User ID (new customer)', async () => {
    const { client, calls } = fakeStripe([]);
    const r = await service(client).createCheckout(SESSION_USER, {
      priceId: 'price_pro_year',
      ...URLS,
    });

    expect(r).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      sessionId: 'cs_test_1',
    });
    // The customer is created tagged, from the account row, not the JWT.
    expect(calls.lookups).toEqual([ACCOUNT.email]);
    expect(calls.customersCreated).toEqual([
      { email: ACCOUNT.email, metadata: { app_user_id: ACCOUNT.external_id } },
    ]);
    const p = calls.checkout[0];
    expect(p.mode).toBe('subscription');
    expect(p.line_items).toEqual([{ price: 'price_pro_year', quantity: 1 }]);
    expect(p.client_reference_id).toBe(ACCOUNT.external_id);
    expect(p.customer).toBe('cus_new');
    expect(p.metadata).toEqual({
      app_user_id: ACCOUNT.external_id,
      plan_code: 'pro',
    });
    expect(p.subscription_data?.metadata?.app_user_id).toBe(
      ACCOUNT.external_id,
    );
    expect(p.success_url).toBe(URLS.successUrl);
    expect(p.allow_promotion_codes).toBe(true);
    expect(rcLookups).toEqual([ACCOUNT.external_id]);
  });

  it("reuses the account's existing Stripe customer", async () => {
    const { client, calls } = fakeStripe([CUSTOMER]);
    await service(client).createCheckout(SESSION_USER, {
      priceId: 'price_lite_year',
      successUrl: 'bookplayer://ok',
      cancelUrl: 'bookplayer://cancel',
    });
    expect(calls.checkout[0].customer).toBe('cus_1');
    expect(calls.customersCreated).toEqual([]);
  });

  it('rejects unknown prices, disallowed URLs, and unconfigured billing', async () => {
    const { client, calls } = fakeStripe();
    expect(
      await codeOf(() =>
        service(client).createCheckout(SESSION_USER, {
          priceId: 'price_nope',
          ...URLS,
        }),
      ),
    ).toBe('400 PRICE_INVALID');
    expect(
      await codeOf(() =>
        service(client).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          successUrl: 'https://evil.example.com/a',
          cancelUrl: URLS.cancelUrl,
        }),
      ),
    ).toBe('400 RETURN_URL_NOT_ALLOWED');
    expect(
      await codeOf(() =>
        service(null).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('503 BILLING_UNAVAILABLE');
    expect(calls.checkout).toEqual([]);
  });

  it('a web subscriber cannot buy a second subscription by going through checkout again', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year')],
    );
    expect(
      await codeOf(() =>
        service(client).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('409 ALREADY_SUBSCRIBED');
    expect(calls.checkout).toEqual([]);

    // past_due is still a subscription they are on.
    const pastDue = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year', { status: 'past_due' })],
    );
    expect(
      await codeOf(() =>
        service(pastDue.client).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('409 ALREADY_SUBSCRIBED');

    // A cancelled subscription is history, so buying again is allowed.
    const fresh = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year', { status: 'canceled' })],
    );
    await service(fresh.client).createCheckout(SESSION_USER, {
      priceId: 'price_pro_year',
      ...URLS,
    });
    expect(fresh.calls.checkout).toHaveLength(1);
  });

  it('refuses when RevenueCat reports an active pro or lite entitlement from a store', async () => {
    for (const tier of ['pro', 'lite']) {
      rcState = { active: true, verified: 'rc', subscriptions: [tier] };
      const { client, calls } = fakeStripe([]);
      expect(
        await codeOf(() =>
          service(client).createCheckout(SESSION_USER, {
            priceId: 'price_pro_year',
            ...URLS,
          }),
        ),
      ).toBe('409 ALREADY_SUBSCRIBED');
      expect(calls.checkout).toEqual([]);
      expect(calls.customersCreated).toEqual([]);
    }

    // `plus` is another product line and does not block a web purchase.
    rcState = { active: true, verified: 'rc', subscriptions: ['plus'] };
    const plus = fakeStripe([]);
    await service(plus.client).createCheckout(SESSION_USER, {
      priceId: 'price_pro_year',
      ...URLS,
    });
    expect(plus.calls.checkout).toHaveLength(1);
  });

  it('skips the store check only when configured to (development without RevenueCat credentials)', async () => {
    rcState = null; // RC unreachable: would be a 503 if asked
    const { client, calls } = fakeStripe([CUSTOMER], []);
    await service(client, { skipStoreEntitlementCheck: true }).createCheckout(
      SESSION_USER,
      { priceId: 'price_pro_year', ...URLS },
    );
    expect(rcLookups).toEqual([]);
    expect(calls.checkout).toHaveLength(1);

    const rc = {
      REVENUECAT_PROJECT_ID: 'proj_1',
      REVENUECAT_API_V2_KEY: 'sk_1',
    };
    const skip = (env: NodeJS.ProcessEnv) =>
      billingConfigFromEnv(env).skipStoreEntitlementCheck;
    expect(skip({ NODE_ENV: 'development' })).toBe(true);
    expect(skip({ NODE_ENV: 'development', ...rc })).toBe(false);
    // Production never skips, credentials or not: it fails closed instead.
    expect(skip({ NODE_ENV: 'production' })).toBe(false);
    expect(skip({ NODE_ENV: 'production', ...rc })).toBe(false);
  });

  it("fails closed when Stripe or RevenueCat cannot confirm the account's state", async () => {
    const { client, calls } = fakeStripe([CUSTOMER], []);
    client.listCustomersByEmail = async () => {
      throw new Error('Stripe timed out');
    };
    expect(
      await codeOf(() =>
        service(client).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('503 BILLING_UNAVAILABLE');

    const subsDown = fakeStripe([CUSTOMER], []);
    subsDown.client.listSubscriptions = async () => {
      throw new Error('Stripe timed out');
    };
    expect(
      await codeOf(() =>
        service(subsDown.client).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('503 BILLING_UNAVAILABLE');

    rcState = null; // RC unreachable
    const rcDown = fakeStripe([]);
    expect(
      await codeOf(() =>
        service(rcDown.client).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('503 BILLING_UNAVAILABLE');

    expect([
      ...calls.checkout,
      ...subsDown.calls.checkout,
      ...rcDown.calls.checkout,
    ]).toEqual([]);
  });

  it('an account that cannot be loaded is not sent to Checkout', async () => {
    const { client, calls } = fakeStripe([]);
    expect(
      await codeOf(() =>
        service(client, {}, null).createCheckout(SESSION_USER, {
          priceId: 'price_pro_year',
          ...URLS,
        }),
      ),
    ).toBe('503 BILLING_UNAVAILABLE');
    expect(calls.checkout).toEqual([]);
  });
});

describe('BillingService customer resolution and portal', () => {
  it('picks the right customer (tagged > subscribed > newest) and passes the portal configuration', async () => {
    const customers: StripeCustomer[] = [
      { id: 'cus_newest', email: ACCOUNT.email, created: 300 },
      {
        id: 'cus_subscribed',
        email: ACCOUNT.email,
        created: 200,
        subscriptions: { data: [{ id: 'sub_1', status: 'active' }] },
      },
      {
        id: 'cus_tagged',
        email: ACCOUNT.email,
        created: 100,
        metadata: { app_user_id: ACCOUNT.external_id },
      },
    ];
    const { client, calls } = fakeStripe(customers);
    const r = await service(client, {
      portalConfigurationId: 'bpc_123',
    }).createPortal(SESSION_USER, {
      returnUrl: 'https://web.bookplayer.test/account',
    });
    expect(r.url).toBe('https://billing.stripe.com/p/session/bps_1');
    expect(calls.portal[0]).toEqual({
      customer: 'cus_tagged',
      return_url: 'https://web.bookplayer.test/account',
      configuration: 'bpc_123',
    });

    const noTag = fakeStripe(customers.filter((c) => c.id !== 'cus_tagged'));
    await service(noTag.client).createPortal(SESSION_USER, {
      returnUrl: 'https://web.bookplayer.test/a',
    });
    expect(noTag.calls.portal[0].customer).toBe('cus_subscribed');

    const plain = fakeStripe([
      customers[0],
      { id: 'cus_older', email: ACCOUNT.email, created: 50 },
    ]);
    await service(plain.client).createPortal(SESSION_USER, {
      returnUrl: 'https://web.bookplayer.test/a',
    });
    expect(plain.calls.portal[0].customer).toBe('cus_newest');
  });

  it("never uses a customer tagged with another account's App User ID", async () => {
    // e.g. a deleted account on the same email that subscribed on the web.
    const other: StripeCustomer = {
      id: 'cus_other',
      email: ACCOUNT.email,
      created: 500,
      metadata: { app_user_id: 'someone-else' },
      subscriptions: { data: [{ id: 'sub_9', status: 'active' }] },
    };
    const { client } = fakeStripe([other], [subscription('price_pro_year')]);
    expect(
      await codeOf(() =>
        service(client).createPortal(SESSION_USER, {
          returnUrl: 'https://web.bookplayer.test/a',
        }),
      ),
    ).toBe('404 BILLING_NO_CUSTOMER');

    const checkout = fakeStripe([other], [subscription('price_pro_year')]);
    await service(checkout.client).createCheckout(SESSION_USER, {
      priceId: 'price_pro_year',
      ...URLS,
    });
    expect(checkout.calls.checkout[0].customer).toBe('cus_new');
  });

  it('portal: no customer -> 404; disallowed return_url -> 400', async () => {
    const { client } = fakeStripe([]);
    expect(
      await codeOf(() =>
        service(client).createPortal(SESSION_USER, {
          returnUrl: 'https://web.bookplayer.test/a',
        }),
      ),
    ).toBe('404 BILLING_NO_CUSTOMER');
    expect(
      await codeOf(() =>
        service(client).createPortal(SESSION_USER, {
          returnUrl: 'https://evil.example.com/',
        }),
      ),
    ).toBe('400 RETURN_URL_NOT_ALLOWED');
  });
});

describe('isPlanUpgrade', () => {
  const plan = (priceId: string) =>
    parsePlans(PLANS).find((p) => p.price_id === priceId);

  it.each([
    // Tier decides, whatever the interval or the amount per charge.
    ['price_lite_month', 'price_pro_month', true],
    ['price_lite_year', 'price_pro_month', true],
    ['price_lite_month', 'price_pro_year', true],
    ['price_pro_month', 'price_lite_year', false],
    ['price_pro_year', 'price_lite_month', false],
    ['price_pro_year', 'price_lite_year', false],
    // Same tier: the longer interval is the upgrade.
    ['price_lite_month', 'price_lite_year', true],
    ['price_pro_year', 'price_pro_month', false],
  ])('%s -> %s is an upgrade: %s', (from, to, expected) => {
    expect(isPlanUpgrade(plan(from), plan(to))).toBe(expected);
  });

  it('an unknown current price is an upgrade; an unranked plan_code falls back to interval, then amount', () => {
    const lite = plan('price_lite_month');
    expect(isPlanUpgrade(null, lite)).toBe(true);
    const family = { ...lite, plan_code: 'family', amount: 9.99 };
    expect(isPlanUpgrade(lite, family)).toBe(true);
    expect(isPlanUpgrade(family, lite)).toBe(false);
    expect(isPlanUpgrade(family, { ...family, interval: 'year' })).toBe(true);
  });
});

describe('BillingService.createTip', () => {
  const TIP = {
    priceId: 'price_tip_kind',
    successUrl: 'https://web.bookplayer.test/thanks',
    cancelUrl: 'https://web.bookplayer.test/support',
  };

  it('parses STRIPE_TIPS like the plans: invalid entries dropped, currency upper-cased', () => {
    const tips = parseTips(TIPS);
    expect(tips).toEqual([
      {
        price_id: 'price_tip_kind',
        tip_code: 'kind',
        name: 'Kind tip',
        amount: 1.99,
        currency: 'USD',
      },
    ]);
    expect(
      billingConfigFromEnv({ STRIPE_TIPS: JSON.stringify(TIPS) }).tips,
    ).toHaveLength(2);
    expect(billingConfigFromEnv({}).tips).toEqual([]);
  });

  it('anyone can tip: a one-time donate Checkout with no customer and no account', async () => {
    const { client, calls } = fakeStripe([], []);
    const result = await service(client).createTip(null, TIP);

    expect(result.url).toBeTruthy();
    expect(calls.checkout).toEqual([
      {
        mode: 'payment',
        submit_type: 'donate',
        line_items: [{ price: 'price_tip_kind', quantity: 1 }],
        success_url: TIP.successUrl,
        cancel_url: TIP.cancelUrl,
        metadata: { tip_code: 'kind' },
        payment_intent_data: { metadata: { tip_code: 'kind' } },
      },
    ]);
    expect(calls.customersCreated).toEqual([]);
  });

  it('a signed-in subscriber can tip too, attributed to their App User ID', async () => {
    rcState = { active: true, verified: 'rc', subscriptions: ['pro'] };
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year')],
    );
    await service(client).createTip(SESSION_USER, TIP);

    const metadata = { tip_code: 'kind', app_user_id: ACCOUNT.external_id };
    expect(calls.checkout[0]).toMatchObject({
      mode: 'payment',
      client_reference_id: ACCOUNT.external_id,
      // Checkout doesn't ask them for an email it already knows.
      customer_email: ACCOUNT.email,
      metadata,
      payment_intent_data: { metadata },
    });
    // None of checkout's purchase guards: a tip buys nothing.
    expect(rcLookups).toEqual([]);
    expect(calls.customersCreated).toEqual([]);
  });

  it('an account that cannot be loaded still tips, unattributed', async () => {
    const { client, calls } = fakeStripe([], []);
    await service(client, {}, null).createTip(SESSION_USER, TIP);
    expect(calls.checkout[0].client_reference_id).toBeUndefined();
    expect(calls.checkout[0].metadata).toEqual({ tip_code: 'kind' });
  });

  it('only tip prices, only allowed return URLs, and only with Stripe configured', async () => {
    const { client } = fakeStripe([], []);
    expect(
      await codeOf(() =>
        service(client).createTip(null, { ...TIP, priceId: 'price_pro_year' }),
      ),
    ).toBe('400 PRICE_INVALID');
    expect(
      await codeOf(() =>
        service(client).createTip(null, {
          ...TIP,
          successUrl: 'https://evil.test/thanks',
        }),
      ),
    ).toBe('400 RETURN_URL_NOT_ALLOWED');
    expect(await codeOf(() => service(null).createTip(null, TIP))).toBe(
      '503 BILLING_UNAVAILABLE',
    );
  });
});

describe('BillingService.changePlan', () => {
  it('upgrading (Lite -> Pro) applies now and invoices the difference once paid', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year')],
    );
    const result = await service(client).changePlan(SESSION_USER, {
      priceId: 'price_pro_year',
    });

    expect(result).toEqual({
      plan_code: 'pro',
      effective: 'now',
      effective_at: null,
    });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].id).toBe('sub_1');
    expect(calls.updates[0].params).toEqual({
      items: [{ id: 'si_1', price: 'price_pro_year' }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });
    expect(calls.schedulesCreated).toEqual([]);
  });

  it('downgrading (Pro -> Lite) waits for the period already paid for, and refunds nothing', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year')],
    );
    const result = await service(client).changePlan(SESSION_USER, {
      priceId: 'price_lite_year',
    });

    expect(result).toEqual({
      plan_code: 'lite',
      effective: 'period_end',
      effective_at: new Date(PERIOD_END * 1000).toISOString(),
    });
    expect(calls.updates).toEqual([]);
    expect(calls.schedulesCreated).toEqual(['sub_1']);
    const [{ phases, end_behavior }] = calls.schedulePhases;
    expect(phases).toHaveLength(2);
    expect(phases[0].items).toEqual([{ price: 'price_pro_year', quantity: 1 }]);
    expect(phases[0].end_date).toBe(PERIOD_END);
    expect(phases[1].items).toEqual([
      { price: 'price_lite_year', quantity: 1 },
    ]);
    expect(phases[1].proration_behavior).toBe('none');
    expect(end_behavior).toBe('release');
  });

  it('Lite yearly -> Pro monthly is an upgrade applied now, though each charge is smaller', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year')],
    );
    const result = await service(client).changePlan(SESSION_USER, {
      priceId: 'price_pro_month',
    });

    expect(result.effective).toBe('now');
    expect(calls.updates[0].params.items).toEqual([
      { id: 'si_1', price: 'price_pro_month' },
    ]);
    expect(calls.schedulesCreated).toEqual([]);
  });

  it('Pro monthly -> Lite yearly is a downgrade at the period end, though each charge is larger', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_month')],
    );
    const result = await service(client).changePlan(SESSION_USER, {
      priceId: 'price_lite_year',
    });

    expect(result.effective).toBe('period_end');
    expect(calls.updates).toEqual([]);
    expect(calls.schedulePhases[0].phases[1].items).toEqual([
      { price: 'price_lite_year', quantity: 1 },
    ]);
  });

  it('reuses an existing schedule and re-sends its current phase intact', async () => {
    const started = PERIOD_END - 365 * 86_400;
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year', { schedule: 'sub_sched_existing' })],
      {
        sub_sched_existing: {
          id: 'sub_sched_existing',
          phases: [
            {
              items: [{ price: 'price_pro_year', quantity: 1 }],
              start_date: started,
              end_date: PERIOD_END,
            },
          ],
        },
      },
    );
    await service(client).changePlan(SESSION_USER, {
      priceId: 'price_lite_year',
    });

    expect(calls.schedulesCreated).toEqual([]);
    const [{ id, phases }] = calls.schedulePhases;
    expect(id).toBe('sub_sched_existing');
    expect(phases[0].start_date).toBe(started);
    expect(phases[0].end_date).toBe(PERIOD_END);
    // Same first price as the live item: their own downgrade, not stale.
    expect(calls.released).toEqual([]);
  });

  it('reads the period end from the subscription item, as newer API versions report it', async () => {
    const onItem = {
      id: 'sub_1',
      status: 'active',
      items: {
        data: [
          {
            id: 'si_1',
            price: { id: 'price_pro_year' },
            current_period_end: PERIOD_END,
          },
        ],
      },
    } as StripeSubscription;
    const { client, calls } = fakeStripe([CUSTOMER], [onItem]);
    const result = await service(client).changePlan(SESSION_USER, {
      priceId: 'price_lite_year',
    });
    expect(result.effective_at).toBe(new Date(PERIOD_END * 1000).toISOString());
    expect(calls.schedulePhases[0].phases[0].end_date).toBe(PERIOD_END);
  });

  it('refuses what it cannot do, by name', async () => {
    const withSub = service(
      fakeStripe([CUSTOMER], [subscription('price_lite_year')]).client,
    );
    expect(
      await codeOf(() =>
        withSub.changePlan(SESSION_USER, { priceId: 'price_unknown' }),
      ),
    ).toBe('400 PRICE_INVALID');
    expect(
      await codeOf(() =>
        withSub.changePlan(SESSION_USER, { priceId: 'price_lite_year' }),
      ),
    ).toBe('409 ALREADY_ON_PLAN');
    const noSub = service(fakeStripe([CUSTOMER], []).client);
    expect(
      await codeOf(() =>
        noSub.changePlan(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('404 NO_SUBSCRIPTION');
    // A store subscriber has no Stripe customer: there is nothing to change here.
    const noCustomer = service(fakeStripe([], []).client);
    expect(
      await codeOf(() =>
        noCustomer.changePlan(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('404 BILLING_NO_CUSTOMER');
    expect(
      await codeOf(() =>
        service(null).changePlan(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('503 BILLING_UNAVAILABLE');
  });

  it('upgrading cancels a downgrade that was already scheduled', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year', { schedule: 'sub_sched_pending' })],
    );
    await service(client).changePlan(SESSION_USER, {
      priceId: 'price_pro_year',
    });
    expect(calls.released).toEqual(['sub_sched_pending']);
  });

  it('an upgrade waiting on payment does not hand over the plan, nor drop the scheduled downgrade', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year', { schedule: 'sub_sched_pending' })],
    );
    client.updateSubscription = async () => ({
      ...subscription('price_lite_year'),
      pending_update: { expires_at: 1 },
    });
    expect(
      await codeOf(() =>
        service(client).changePlan(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('402 UPGRADE_PAYMENT_PENDING');
    expect(calls.released).toEqual([]);
  });

  it('an upgrade that went through still succeeds if releasing the old schedule fails', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year', { schedule: 'sub_sched_stuck' })],
    );
    client.releaseSchedule = async () => {
      throw new Error('Stripe is having a moment');
    };
    const result = await service(client).changePlan(SESSION_USER, {
      priceId: 'price_pro_year',
    });
    expect(result.effective).toBe('now');
    expect(calls.updates[0].params.proration_behavior).toBe('always_invoice');
  });

  it('an upgrade the bank cleared late does not revert at period end', async () => {
    // Pro now on the item, but a schedule from the earlier Lite period still
    // starts from Lite: stale, and released on the next change attempt.
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year', { schedule: 'sub_sched_pending' })],
      {
        sub_sched_pending: {
          id: 'sub_sched_pending',
          phases: [
            {
              items: [{ price: 'price_lite_year', quantity: 1 }],
              end_date: PERIOD_END,
            },
            { items: [{ price: 'price_other', quantity: 1 }] },
          ],
        },
      },
    );
    expect(
      await codeOf(() =>
        service(client).changePlan(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('409 ALREADY_ON_PLAN');
    expect(calls.released).toEqual(['sub_sched_pending']);
  });

  it('a scheduled downgrade the customer meant to keep survives a no-op change and a preview', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year', { schedule: 'sub_sched_pending' })],
      {
        sub_sched_pending: {
          id: 'sub_sched_pending',
          phases: [
            {
              items: [{ price: 'price_pro_year', quantity: 1 }],
              end_date: PERIOD_END,
            },
            { items: [{ price: 'price_lite_year', quantity: 1 }] },
          ],
        },
      },
    );
    const s = service(client);
    expect(
      await codeOf(() =>
        s.changePlan(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('409 ALREADY_ON_PLAN');
    expect(
      await codeOf(() =>
        s.previewChange(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('409 ALREADY_ON_PLAN');
    expect(calls.released).toEqual([]);
  });
});

describe('BillingService.previewChange', () => {
  it('prices an upgrade in major units, exactly as Stripe computed it', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_lite_year')],
    );
    const quote = await service(client).previewChange(SESSION_USER, {
      priceId: 'price_pro_year',
    });

    expect(quote).toEqual({
      plan_code: 'pro',
      effective: 'now',
      effective_at: null,
      currency: 'USD',
      lines: [
        { description: 'Unused time on BookPlayer Lite (Web)', amount: -1.99 },
        { description: 'BookPlayer Pro (Web)', amount: 4.99 },
      ],
      subtotal: 3,
      tax: 0.3,
      total: 3.3,
      amount_due: 3.3,
    });
    expect(calls.previews[0]).toEqual({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: {
        items: [{ id: 'si_1', price: 'price_pro_year' }],
        proration_behavior: 'always_invoice',
      },
    });
    // A preview charges nobody.
    expect(calls.updates).toEqual([]);
    expect(calls.schedulesCreated).toEqual([]);
  });

  it('prices a downgrade for the next period, not today', async () => {
    const { client, calls } = fakeStripe(
      [CUSTOMER],
      [subscription('price_pro_year')],
    );
    const quote = await service(client).previewChange(SESSION_USER, {
      priceId: 'price_lite_year',
    });
    expect(quote.effective).toBe('period_end');
    expect(quote.effective_at).toBe(new Date(PERIOD_END * 1000).toISOString());
    expect(calls.previews[0].subscription_details.proration_behavior).toBe(
      'none',
    );
    expect(calls.schedulesCreated).toEqual([]);
  });

  it("reads tax whichever field the account's API version uses", async () => {
    const base = {
      currency: 'usd',
      subtotal: 1000,
      total: 1120,
      amount_due: 1120,
      lines: { data: [] as StripeInvoicePreview['lines']['data'] },
    };
    const tax = async (over: Partial<StripeInvoicePreview>) =>
      (
        await service(
          fakeStripe([CUSTOMER], [subscription('price_lite_year')], {}, {
            ...base,
            ...over,
          } as StripeInvoicePreview).client,
        ).previewChange(SESSION_USER, { priceId: 'price_pro_year' })
      ).tax;
    expect(await tax({ total_taxes: [{ amount: 80 }, { amount: 40 }] })).toBe(
      1.2,
    );
    expect(await tax({ total_tax_amounts: [{ amount: 120 }] })).toBe(1.2);
    expect(await tax({ tax: 120 })).toBe(1.2);
    expect(await tax({})).toBe(0);
  });

  it('refuses exactly what the change itself refuses', async () => {
    const s = service(
      fakeStripe([CUSTOMER], [subscription('price_lite_year')]).client,
    );
    expect(
      await codeOf(() => s.previewChange(SESSION_USER, { priceId: 'nope' })),
    ).toBe('400 PRICE_INVALID');
    expect(
      await codeOf(() =>
        s.previewChange(SESSION_USER, { priceId: 'price_lite_year' }),
      ),
    ).toBe('409 ALREADY_ON_PLAN');
    const noSub = service(fakeStripe([CUSTOMER], []).client);
    expect(
      await codeOf(() =>
        noSub.previewChange(SESSION_USER, { priceId: 'price_pro_year' }),
      ),
    ).toBe('404 NO_SUBSCRIPTION');
  });
});
