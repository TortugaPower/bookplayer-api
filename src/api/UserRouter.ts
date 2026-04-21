import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import type { UserController } from '../controllers/UserController';
import type { SubscriptionController } from '../controllers/SubscriptionController';
import { authRateLimiter } from './middlewares/rateLimit';

@injectable()
export class UserRouter {
  @inject(TYPES.UserController) private _controller: UserController;
  @inject(TYPES.SubscriptionController)
  private _subscription: SubscriptionController;

  get(): express.Router {
    const router = express.Router();
    router.get('/', (req, res, next) =>
      this._controller.getAuth(req, res).catch(next),
    );
    router.post('/login', authRateLimiter, (req, res, next) =>
      this._controller.InitLogin(req, res).catch(next),
    );
    router.get('/logout', (req, res, next) =>
      this._controller.Logout(req, res).catch(next),
    );
    router.post('/second_onboarding', (req, res, next) =>
      this._controller.secondOnboarding(req, res).catch(next),
    );
    router.post('/events', (req, res, next) =>
      this._controller.userEventsHandler(req, res).catch(next),
    );
    router.post('/revenuecat', (req, res, next) =>
      this._subscription.RevenuecatWebhook(req, res).catch(next),
    );
    router.delete('/delete', (req, res, next) =>
      this._controller.DeleteAccount(req, res).catch(next),
    );

    return router;
  }
}
