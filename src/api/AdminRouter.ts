import express from 'express';
import { AdminController } from '../controllers/AdminController';
import { UserAdminMiddleware } from './middlewares/admin';
import { INext, IRequest, IResponse } from '../types/http';

export class AdminRouter {
  constructor(
    private _controller: AdminController,
    private _adminMiddleware: UserAdminMiddleware,
  ) {}

  get(): express.Router {
    const router = express.Router();
    const middleWareInit = (req: IRequest, res: IResponse, next: INext) =>
      this._adminMiddleware.checkUserAdmin(req, res, next);

    router.get('/users_usage', middleWareInit, (req, res, next) =>
      this._controller.SetUserUsage(req, res).catch(next),
    );
    router.get('/validate_sync', middleWareInit, (req, res, next) =>
      this._controller.validateSyncBooks(req, res).catch(next),
    );
    return router;
  }
}
