import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BillingController } from '../../controllers/BillingController';
import { ApiError, ApiErrorCode } from '../../types/apiError';
import { changePlanSchema, checkoutSchema } from '../../validation/billing';
import { mockLoggerService } from '../setup';

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const USER = {
  id_user: 7,
  email: 'reader@example.com',
  external_id: 'rc-app-user-7',
};
const PLANS = [
  {
    price_id: 'price_pro_year',
    plan_code: 'pro',
    name: 'BookPlayer Pro (Web)',
    amount: 4.99,
    currency: 'USD',
    interval: 'year',
  },
];

describe('BillingController', () => {
  let billing: any;
  let controller: BillingController;

  beforeEach(() => {
    billing = {
      listPlans: jest.fn().mockReturnValue(PLANS),
      createCheckout: jest.fn(async () => ({
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        sessionId: 'cs_1',
      })),
      changePlan: jest.fn(async () => ({
        plan_code: 'pro',
        effective: 'now',
        effective_at: null,
      })),
      previewChange: jest.fn(),
      createPortal: jest.fn(async () => ({
        url: 'https://billing.stripe.com/p/session/bps_1',
      })),
      listTips: jest.fn().mockReturnValue([{ price_id: 'price_tip_kind' }]),
      createTip: jest.fn(async () => ({
        url: 'https://checkout.stripe.com/c/pay/cs_tip',
        sessionId: 'cs_tip',
      })),
    };
    controller = new BillingController(billing);
    (controller as any)._logger = mockLoggerService;
  });

  it('GET /plans is public and returns the catalog', async () => {
    const res = makeRes();
    await controller.listPlans({}, res);
    expect(res.json).toHaveBeenCalledWith({ plans: PLANS });
  });

  it('POST /checkout answers { url, session_id }', async () => {
    const res = makeRes();
    const body = {
      price_id: 'price_pro_year',
      success_url: 'https://a.test/ok',
      cancel_url: 'https://a.test/no',
    };
    await controller.createCheckout({ user: USER, body }, res);
    expect(billing.createCheckout).toHaveBeenCalledWith(USER, {
      priceId: 'price_pro_year',
      successUrl: 'https://a.test/ok',
      cancelUrl: 'https://a.test/no',
    });
    expect(res.json).toHaveBeenCalledWith({
      url: 'https://checkout.stripe.com/c/pay/cs_1',
      session_id: 'cs_1',
    });
  });

  it('tips need no session: listed and bought anonymously, attributed when signed in', async () => {
    const list = makeRes();
    await controller.listTips({}, list);
    expect(list.json).toHaveBeenCalledWith({
      tips: [{ price_id: 'price_tip_kind' }],
    });

    const body = {
      price_id: 'price_tip_kind',
      success_url: 'https://a.test/thanks',
      cancel_url: 'https://a.test/no',
    };
    const input = {
      priceId: 'price_tip_kind',
      successUrl: 'https://a.test/thanks',
      cancelUrl: 'https://a.test/no',
    };
    const anon = makeRes();
    await controller.createTip({ body }, anon);
    expect(anon.status).not.toHaveBeenCalled();
    expect(billing.createTip).toHaveBeenLastCalledWith(null, input);
    expect(anon.json).toHaveBeenCalledWith({
      url: 'https://checkout.stripe.com/c/pay/cs_tip',
      session_id: 'cs_tip',
    });

    await controller.createTip({ user: USER, body }, makeRes());
    expect(billing.createTip).toHaveBeenLastCalledWith(USER, input);
  });

  it('every session route needs a logged-in user (401)', async () => {
    for (const handler of [
      'createCheckout',
      'changePlan',
      'previewChangePlan',
      'createPortal',
    ] as const) {
      const res = makeRes();
      await controller[handler]({ body: {}, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(billing.createCheckout).not.toHaveBeenCalled();
    expect(billing.createPortal).not.toHaveBeenCalled();
  });

  it('service errors go out as { message, error } with their status', async () => {
    billing.changePlan.mockRejectedValue(
      new ApiError(ApiErrorCode.ALREADY_ON_PLAN, 409, 'already on pro'),
    );
    const res = makeRes();
    await controller.changePlan(
      { user: USER, body: { price_id: 'price_pro_year' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: 'already on pro',
      error: 'ALREADY_ON_PLAN',
    });
  });

  it('a Stripe SDK failure is a 503 BILLING_UNAVAILABLE; anything else a 500', async () => {
    billing.previewChange.mockRejectedValue(
      Object.assign(new Error('connection reset'), {
        type: 'StripeConnectionError',
      }),
    );
    const res = makeRes();
    await controller.previewChangePlan(
      { user: USER, body: { price_id: 'p' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'BILLING_UNAVAILABLE' }),
    );

    // A request Stripe refuses (an unknown price, a bad configuration) is
    // ours to fix, not a reason to retry.
    billing.previewChange.mockRejectedValue(
      Object.assign(new Error('No such price'), {
        type: 'StripeInvalidRequestError',
      }),
    );
    const invalid = makeRes();
    await controller.previewChangePlan(
      { user: USER, body: { price_id: 'p' } },
      invalid,
    );
    expect(invalid.status).toHaveBeenCalledWith(500);

    billing.previewChange.mockRejectedValue(new Error('bug'));
    const res500 = makeRes();
    await controller.previewChangePlan(
      { user: USER, body: { price_id: 'p' } },
      res500,
    );
    expect(res500.status).toHaveBeenCalledWith(500);
  });

  it('GET /portal validates return_url from the query and answers { url }', async () => {
    const bad = makeRes();
    await controller.createPortal({ user: USER, query: {} }, bad);
    expect(bad.status).toHaveBeenCalledWith(422);
    expect(bad.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_request' }),
    );

    const res = makeRes();
    await controller.createPortal(
      { user: USER, query: { return_url: 'https://a.test/account' } },
      res,
    );
    expect(billing.createPortal).toHaveBeenCalledWith(USER, {
      returnUrl: 'https://a.test/account',
    });
    expect(res.json).toHaveBeenCalledWith({
      url: 'https://billing.stripe.com/p/session/bps_1',
    });
  });
});

describe('billing request schemas', () => {
  it('checkout needs a price_id and two URLs', () => {
    expect(
      checkoutSchema.safeParse({
        price_id: 'p',
        success_url: 'https://a.test',
        cancel_url: 'https://a.test',
      }).success,
    ).toBe(true);
    expect(
      checkoutSchema.safeParse({
        price_id: 'p',
        success_url: 'nope',
        cancel_url: 'https://a.test',
      }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({
        success_url: 'https://a.test',
        cancel_url: 'https://a.test',
      }).success,
    ).toBe(false);
  });

  it('change-plan needs a non-empty price_id', () => {
    expect(
      changePlanSchema.safeParse({ price_id: 'price_pro_year' }).success,
    ).toBe(true);
    expect(changePlanSchema.safeParse({ price_id: '  ' }).success).toBe(false);
    expect(changePlanSchema.safeParse({}).success).toBe(false);
  });
});
