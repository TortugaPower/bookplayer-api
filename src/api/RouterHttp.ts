import express from 'express';
import { UserRouter } from './UserRouter';
import { LibraryRouter } from './LibraryRouter';
import { AdminRouter } from './AdminRouter';
import { StorageRouter } from './StorageRouter';
import { RetentionMessagingRouter } from './RetentionMessagingRouter';
import { PasskeyRouter } from './PasskeyRouter';

export class RouterHttp {
  constructor(
    private _authRouter: UserRouter,
    private _libraryRouter: LibraryRouter,
    private _adminRouter: AdminRouter,
    private _storageRouter: StorageRouter,
    private _passkeyRouter: PasskeyRouter,
    private _retentionRouter: RetentionMessagingRouter,
  ) {}

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
