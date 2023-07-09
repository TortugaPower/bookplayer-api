import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IAdminRouter } from '../interfaces/IRouters';
import { IAdminController } from '../interfaces/IAdminController';

@injectable()
export class AdminRouter implements IAdminRouter {
  @inject(TYPES.AdminController)
  private _controller: IAdminController;

  get(): express.Router {
    const router = express.Router();
    router.get('/users_usage', (req, res, next) =>
      this._controller.SetUserUsage(req, res, next).catch(next),
    );
    router.get('/validate_sync', (req, res, next) =>
      this._controller.validateSyncBooks(req, res, next).catch(next),
    );
    return router;
  }
}
