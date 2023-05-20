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
    router.post('/reorder', (req, res, next) =>
      this._controller.reorderLibraryObject(req, res, next).catch(next),
    );
    router.post('/move', (req, res, next) =>
      this._controller.moveLibraryObject(req, res, next).catch(next),
    );
    router.delete('/folder_in_out', (req, res, next) =>
      this._controller.deleteFolderMoving(req, res, next).catch(next),
    );
    router.get('/last_played', (req, res, next) =>
      this._controller.getLastPlayedItem(req, res, next).catch(next),
    );
    router.post('/bookmarks', (req, res, next) =>
      this._controller.getAllUserBookmarks(req, res, next).catch(next),
    );
    router.put('/bookmark', (req, res, next) =>
      this._controller.upsertBookmark(req, res, next).catch(next),
    );
    router.post('/thumbnail_set', (req, res, next) =>
      this._controller.itemThumbnailPutRequest(req, res, next).catch(next),
    );
    return router;
  }
}
