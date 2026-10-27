import { BillingService } from '../services/BillingService';
import { logger } from '../services/LoggerService';
import { ApiError, ApiErrorCode } from '../types/apiError';
import { IRequest, IResponse } from '../types/http';
import {
  ChangePlanBody,
  CheckoutBody,
  portalQuerySchema,
} from '../validation/billing';

const TRANSIENT_STRIPE_ERRORS = new Set([
  'StripeConnectionError',
  'StripeAPIError',
  'StripeRateLimitError',
]);

// /v1/billing: web subscriptions through Stripe. Bodies are validated at the
// route (validateBody); every error answers `{ message, error }`.
export class BillingController {
  private readonly _logger = logger;

  constructor(private _billingService: BillingService = new BillingService()) {}

  // GET /plans: the static catalog (STRIPE_PLANS). Public.
  public async listPlans(_req: IRequest, res: IResponse): Promise<IResponse> {
    return res.json({ plans: this._billingService.listPlans() });
  }

  // POST /checkout { price_id, success_url, cancel_url } -> { url, session_id }
  public async createCheckout(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    if (!req.user?.id_user) return this.unauthenticated(res);
    try {
      const body = req.body as CheckoutBody;
      const result = await this._billingService.createCheckout(req.user, {
        priceId: body.price_id,
        successUrl: body.success_url,
        cancelUrl: body.cancel_url,
      });
      return res.json({ url: result.url, session_id: result.sessionId });
    } catch (err) {
      return this.sendBillingError(
        res,
        err,
        'BillingController.createCheckout',
        req,
      );
    }
  }

  // GET /tips: the tip catalog (STRIPE_TIPS). Public.
  public async listTips(_req: IRequest, res: IResponse): Promise<IResponse> {
    return res.json({ tips: this._billingService.listTips() });
  }

  // POST /tip { price_id, success_url, cancel_url } -> { url, session_id }.
  // No session needed: anyone may tip; a signed-in tipper is attributed.
  public async createTip(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const body = req.body as CheckoutBody;
      const result = await this._billingService.createTip(
        req.user?.id_user ? req.user : null,
        {
          priceId: body.price_id,
          successUrl: body.success_url,
          cancelUrl: body.cancel_url,
        },
      );
      return res.json({ url: result.url, session_id: result.sessionId });
    } catch (err) {
      return this.sendBillingError(
        res,
        err,
        'BillingController.createTip',
        req,
      );
    }
  }

  // POST /change-plan { price_id } -> { plan_code, effective, effective_at }
  public async changePlan(req: IRequest, res: IResponse): Promise<IResponse> {
    if (!req.user?.id_user) return this.unauthenticated(res);
    try {
      const { price_id } = req.body as ChangePlanBody;
      return res.json(
        await this._billingService.changePlan(req.user, { priceId: price_id }),
      );
    } catch (err) {
      return this.sendBillingError(
        res,
        err,
        'BillingController.changePlan',
        req,
      );
    }
  }

  // POST /change-plan/preview { price_id } -> the change, priced by Stripe.
  public async previewChangePlan(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    if (!req.user?.id_user) return this.unauthenticated(res);
    try {
      const { price_id } = req.body as ChangePlanBody;
      return res.json(
        await this._billingService.previewChange(req.user, {
          priceId: price_id,
        }),
      );
    } catch (err) {
      return this.sendBillingError(
        res,
        err,
        'BillingController.previewChangePlan',
        req,
      );
    }
  }

  // GET /portal?return_url= -> { url }
  public async createPortal(req: IRequest, res: IResponse): Promise<IResponse> {
    if (!req.user?.id_user) return this.unauthenticated(res);
    const parsed = portalQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
        error: 'invalid_request',
      });
    }
    try {
      const result = await this._billingService.createPortal(req.user, {
        returnUrl: parsed.data.return_url,
      });
      return res.json({ url: result.url });
    } catch (err) {
      return this.sendBillingError(
        res,
        err,
        'BillingController.createPortal',
        req,
      );
    }
  }

  private unauthenticated(res: IResponse): IResponse {
    return res.status(401).json({ message: 'Authentication required' });
  }

  private sendBillingError(
    res: IResponse,
    err: Error,
    origin: string,
    req: IRequest,
  ): IResponse {
    if (err instanceof ApiError) {
      this._logger.log(
        {
          origin,
          message: err.message,
          data: { id_user: req.user?.id_user, code: err.code },
        },
        err.statusCode >= 500 ? 'error' : 'warn',
      );
      return res
        .status(err.statusCode)
        .json({ message: err.message, error: err.code });
    }
    this._logger.log(
      {
        origin,
        message: err?.message,
        data: { id_user: req.user?.id_user, body: req.body },
      },
      'error',
    );
    // Stripe unreachable, failing or rate limiting us: retry later. Anything
    // else Stripe refuses (an unknown price, a bad portal configuration, a key
    // without permission) is our configuration, and stays a 500 to fix.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const type = (err as any)?.type;
    if (TRANSIENT_STRIPE_ERRORS.has(type)) {
      return res.status(503).json({
        message: 'Billing is temporarily unavailable. Try again in a moment.',
        error: ApiErrorCode.BILLING_UNAVAILABLE,
      });
    }
    return res.status(500).json({ message: 'Internal error' });
  }
}
