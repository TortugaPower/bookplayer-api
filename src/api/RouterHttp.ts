import express from 'express';
import { inject, injectable } from 'inversify';
import { IUserRouter } from '../interfaces/IRouters';
import { TYPES } from '../ContainerTypes';

@injectable()
export class RouterHttp {
  @inject(TYPES.UserRouter) private _authRouter: IUserRouter;

  get(): express.Router {
    const router = express.Router();
    router.use('/user', this._authRouter.get());

    return router;
  }
}
