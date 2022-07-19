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
    router.get('/', (req, res, next) =>
      this._controller.getLibraryContentPath(req, res, next).catch(next),
    );
    router.post('/', (req, res, next) =>
      this._controller.getLibraryObject(req, res, next).catch(next),
    );
    router.put('/', (req, res, next) =>
      this._controller.putLibraryObject(req, res, next).catch(next),
    );
    router.delete('/', (req, res, next) =>
      this._controller.deleteLibraryObject(req, res, next).catch(next),
    );

    return router;
  }
}