import express from 'express';
import { inject, injectable } from 'inversify';
import type { UserRouter } from './UserRouter';
import type { LibraryRouter } from './LibraryRouter';
import type { AdminRouter } from './AdminRouter';
import type { StorageRouter } from './StorageRouter';
import type { RetentionMessagingRouter } from './RetentionMessagingRouter';
import type { PasskeyRouter } from './PasskeyRouter';
import { TYPES } from '../ContainerTypes';

@injectable()
export class RouterHttp {
  @inject(TYPES.UserRouter) private _authRouter: UserRouter;
  @inject(TYPES.LibraryRouter) private _libraryRouter: LibraryRouter;
  @inject(TYPES.StorageRouter) private _storageRouter: StorageRouter;
  @inject(TYPES.AdminRouter) private _adminRouter: AdminRouter;
  @inject(TYPES.PasskeyRouter) private _passkeyRouter: PasskeyRouter;
  @inject(TYPES.RetentionMessagingRouter)
  private _retentionRouter: RetentionMessagingRouter;

  get(): express.Router {
    const router = express.Router();
    router.get('/status', (req, res) => res.send('OK'));
    router.use('/user', this._authRouter.get());
    router.use('/passkey', this._passkeyRouter.get());
    router.use('/library', this._libraryRouter.get());
    router.use('/admin', this._adminRouter.get());
    router.use('/storage', this._storageRouter.get());
    router.use('/retention', this._retentionRouter.get());

    return router;
  }
}
