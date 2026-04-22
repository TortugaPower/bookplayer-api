import express from 'express';
import { INext, IRequest, IResponse } from '../types/http';
import { StorageController } from '../controllers/StorageController';
import { SubscriptionMiddleware } from './middlewares/subscription';

export class StorageRouter {
  constructor(
    private _controller: StorageController = new StorageController(),
    private _subscription: SubscriptionMiddleware = new SubscriptionMiddleware(),
  ) {}

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
