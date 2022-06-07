import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { ILibraryRouter } from '../interfaces/IRouters';
import { ILibraryController } from '../interfaces/ILibraryController';

@injectable()
export class LibraryRouter implements ILibraryRouter {
  @inject(TYPES.LibraryController) private _controller: ILibraryController;

  get(): express.Router {
    const router = express.Router();
    router.get('/', (...req) => this._controller.getLibraryContentPath(...req));
    router.post('/', (...req) => this._controller.getLibraryObject(...req));

    return router;
  }
}
