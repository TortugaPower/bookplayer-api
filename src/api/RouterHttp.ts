import express from 'express';
import { inject, injectable } from 'inversify';
import {
  IAdminRouter,
  ILibraryRouter,
  IUserRouter,
} from '../interfaces/IRouters';
import { TYPES } from '../ContainerTypes';
import { PasskeyRouter } from './PasskeyRouter';

@injectable()
export class RouterHttp {
  @inject(TYPES.UserRouter) private _authRouter: IUserRouter;
  @inject(TYPES.LibraryRouter) private _libraryRouter: ILibraryRouter;
  @inject(TYPES.StorageRouter) private _storageRouter: IAdminRouter;
  @inject(TYPES.AdminRouter) private _adminRouter: IAdminRouter;
  @inject(TYPES.PasskeyRouter) private _passkeyRouter: PasskeyRouter;

  get(): express.Router {
    const router = express.Router();
    router.get('/status', (req, res) => res.send('OK'));
    router.use('/user', this._authRouter.get());
    router.use('/passkey', this._passkeyRouter.get());
    router.use('/library', this._libraryRouter.get());
    router.use('/admin', this._adminRouter.get());
    router.use('/storage', this._storageRouter.get());

    return router;
  }
}
