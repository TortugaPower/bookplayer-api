import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IStorageRouter } from '../interfaces/IRouters';
import { INext, IRequest, IResponse } from '../interfaces/IRequest';
import { IStorageController } from '../interfaces/IStorageController';
import { ISubscriptionMiddleware } from '../interfaces/ISubscriptionMiddleware';

@injectable()
export class StorageRouter implements IStorageRouter {
  @inject(TYPES.StorageController)
  private _controller: IStorageController;
  @inject(TYPES.SubscriptionMiddleware)
  private _subscription: ISubscriptionMiddleware;

  get(): express.Router {
    const router = express.Router();
    const middleWareInit = (req: IRequest, res: IResponse, next: INext) =>
      this._subscription.checkSubscription(req, res, next);
    router.get('/*', middleWareInit, (req, res, next) =>
      this._controller.getProxyLibrary(req, res, next).catch(next),
    );
    return router;
  }
}
