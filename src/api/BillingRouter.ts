import express from 'express';
import { BillingController } from '../controllers/BillingController';
import { billingRateLimiter } from './middlewares/rateLimit';
import { validateBody } from '../validation/validate';
import { changePlanSchema, checkoutSchema } from '../validation/billing';

const BillingRouter = express.Router();
const controller = new BillingController();

// Read through the export at request time: initRateLimitRedis() replaces the
// memory-store limiter with a Redis one after this module has loaded.
const sessionLimiter: express.RequestHandler = (req, res, next) =>
  billingRateLimiter(req, res, next);

// The plan catalog is public: prices are public information.
BillingRouter.get('/plans', (req, res, next) =>
  controller.listPlans(req, res).catch(next),
);

// Everything else acts on the caller's Stripe customer (auth checked in the
// controller, 401 without a session) and calls Stripe, hence the limiter.
BillingRouter.post(
  '/checkout',
  sessionLimiter,
  validateBody(checkoutSchema),
  (req, res, next) => controller.createCheckout(req, res).catch(next),
);
BillingRouter.get('/portal', sessionLimiter, (req, res, next) =>
  controller.createPortal(req, res).catch(next),
);
// Changing an existing subscription is not a purchase: no Checkout session,
// no second subscription.
BillingRouter.post(
  '/change-plan',
  sessionLimiter,
  validateBody(changePlanSchema),
  (req, res, next) => controller.changePlan(req, res).catch(next),
);
// The same body, priced but not committed, for the confirmation screen.
BillingRouter.post(
  '/change-plan/preview',
  sessionLimiter,
  validateBody(changePlanSchema),
  (req, res, next) => controller.previewChangePlan(req, res).catch(next),
);

export default BillingRouter;
