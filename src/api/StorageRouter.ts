import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { INext, IRequest, IResponse } from '../types/http';
import type { StorageController } from '../controllers/StorageController';
import type { SubscriptionMiddleware } from './middlewares/subscription';

@injectable()
export class StorageRouter {
  @inject(TYPES.StorageController)
  private _controller: StorageController;
  @inject(TYPES.SubscriptionMiddleware)
  private _subscription: SubscriptionMiddleware;

  get(): express.Router {
    const router = express.Router();
    const middleWareInit = (req: IRequest, res: IResponse, next: INext) =>
      this._subscription.checkSubscription(req, res, next);
    router.get('/*', middleWareInit, (req, res, next) =>
      this._controller.getProxyLibrary(req, res).catch(next),
    );
    return router;
  }
}
