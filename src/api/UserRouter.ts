import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IUserController } from '../interfaces/IUserController';
import { IUserRouter } from '../interfaces/IRouters';
import { ISubscriptionController } from '../interfaces/ISubscriptionController';

@injectable()
export class UserRouter implements IUserRouter {
  @inject(TYPES.UserController) private _controller: IUserController;
  @inject(TYPES.SubscriptionController) private _subscription: ISubscriptionController;

  get(): express.Router {
    const router = express.Router();
    router.get('/', (...req) => this._controller.getAuth(...req));
    router.post('/login', (...req) => this._controller.InitLogin(...req));
    router.post('/revenuecat', (...req) => this._subscription.RevenuecatWebhook(...req));
    router.delete('/delete', (...req) => this._controller.DeleteAccount(...req));

    return router;
  }
}
