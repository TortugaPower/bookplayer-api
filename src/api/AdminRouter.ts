import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IAdminRouter } from '../interfaces/IRouters';
import { IAdminController } from '../interfaces/IAdminController';
import { IUserAdminMiddleware } from '../interfaces/IUserAdminMiddleware';
import { INext, IRequest, IResponse } from '../interfaces/IRequest';

@injectable()
export class AdminRouter implements IAdminRouter {
  @inject(TYPES.AdminController)
  private _controller: IAdminController;
  @inject(TYPES.UserAdminMiddleware)
  private _adminMiddleware: IUserAdminMiddleware;

  get(): express.Router {
    const router = express.Router();
    const middleWareInit = (req: IRequest, res: IResponse, next: INext) =>
      this._adminMiddleware.checkUserAdmin(req, res, next);

    router.get('/users_usage', middleWareInit, (req, res, next) =>
      this._controller.SetUserUsage(req, res, next).catch(next),
    );
    router.get('/validate_sync', middleWareInit, (req, res, next) =>
      this._controller.validateSyncBooks(req, res, next).catch(next),
    );
    return router;
  }
}
