import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { ILibraryRouter } from '../interfaces/IRouters';
import { ILibraryController } from '../interfaces/ILibraryController';
import { ISubscriptionMiddleware } from '../interfaces/ISubscriptionMiddleware';
import { INext, IRequest, IResponse } from '../interfaces/IRequest';

@injectable()
export class LibraryRouter implements ILibraryRouter {
  @inject(TYPES.LibraryController) private _controller: ILibraryController;
  @inject(TYPES.SubscriptionMiddleware)
  private _subscription: ISubscriptionMiddleware;

  get(): express.Router {
    const router = express.Router();
    const middleWareInit = (req: IRequest, res: IResponse, next: INext) =>
      this._subscription.checkSubscription(req, res, next);

    router.get('/', middleWareInit, (req, res, next) =>
      this._controller.getLibraryContentPath(req, res, next).catch(next),
    );
    router.post('/', middleWareInit, (req, res, next) =>
      this._controller.getLibraryObject(req, res, next).catch(next),
    );
    router.put('/', middleWareInit, (req, res, next) =>
      this._controller.putLibraryObject(req, res, next).catch(next),
    );
    router.delete('/', middleWareInit, (req, res, next) =>
      this._controller.deleteLibraryObject(req, res, next).catch(next),
    );
    router.post('/reorder', middleWareInit, (req, res, next) =>
      this._controller.reorderLibraryObject(req, res, next).catch(next),
    );
    router.post('/move', middleWareInit, (req, res, next) =>
      this._controller.moveLibraryObject(req, res, next).catch(next),
    );
    router.post('/rename', middleWareInit, (req, res, next) =>
      this._controller.renameLibraryObject(req, res, next).catch(next),
    );
    router.delete('/folder_in_out', middleWareInit, (req, res, next) =>
      this._controller.deleteFolderMoving(req, res, next).catch(next),
    );
    router.get('/last_played', middleWareInit, (req, res, next) =>
      this._controller.getLastPlayedItem(req, res, next).catch(next),
    );
    router.post('/bookmarks', middleWareInit, (req, res, next) =>
      this._controller.getAllUserBookmarks(req, res, next).catch(next),
    );
    router.put('/bookmark', middleWareInit, (req, res, next) =>
      this._controller.upsertBookmark(req, res, next).catch(next),
    );
    router.post('/thumbnail_set', middleWareInit, (req, res, next) =>
      this._controller.itemThumbnailPutRequest(req, res, next).catch(next),
    );
    return router;
  }
}
