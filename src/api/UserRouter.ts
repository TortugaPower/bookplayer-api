import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IUserController } from '../interfaces/IUserController';
import { IUserRouter } from '../interfaces/IRouters';

@injectable()
export class UserRouter implements IUserRouter {
  @inject(TYPES.UserController) private _controller: IUserController;

  get(): express.Router {
    const router = express.Router();
    router.get('/', (...req) => this._controller.getAuth(...req));
    router.post('/login', (...req) => this._controller.InitLogin(...req));

    return router;
  }
}
