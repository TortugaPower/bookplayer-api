import express from 'express';
import { inject, injectable } from 'inversify';
import { ILibraryRouter, IUserRouter } from '../interfaces/IRouters';
import { TYPES } from '../ContainerTypes';

@injectable()
export class RouterHttp {
  @inject(TYPES.UserRouter) private _authRouter: IUserRouter;
  @inject(TYPES.LibraryRouter) private _libraryRouter: ILibraryRouter;

  get(): express.Router {
    const router = express.Router();
    router.get('/status', (req, res) => res.send('OK'));
    router.use('/user', this._authRouter.get());
    router.use('/library', this._libraryRouter.get());

    return router;
  }
}
