import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IUserController } from '../interfaces/IUserController';
import { IUserRouter } from '../interfaces/IRouters';
import { ISubscriptionController } from '../interfaces/ISubscriptionController';

@injectable()
export class UserRouter implements IUserRouter {
  @inject(TYPES.UserController) private _controller: IUserController;
  @inject(TYPES.SubscriptionController)
  private _subscription: ISubscriptionController;

  get(): express.Router {
    const router = express.Router();
    router.get('/', (req, res, next) =>
      this._controller.getAuth(req, res, next).catch(next),
    );
    router.post('/login', (req, res, next) =>
      this._controller.InitLogin(req, res, next).catch(next),
    );
    router.post('/revenuecat', (req, res, next) =>
      this._subscription.RevenuecatWebhook(req, res, next).catch(next),
    );
    router.delete('/delete', (req, res, next) =>
      this._controller.DeleteAccount(req, res, next).catch(next),
    );

    return router;
  }
}
