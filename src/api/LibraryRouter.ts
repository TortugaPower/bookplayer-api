import express from 'express';
import { LibraryController } from '../controllers/LibraryController';
import { SubscriptionMiddleware } from './middlewares/subscription';
import { INext, IRequest, IResponse } from '../types/http';

export class LibraryRouter {
  constructor(
    private _controller: LibraryController,
    private _subscription: SubscriptionMiddleware,
  ) {}

  get(): express.Router {
    const router = express.Router();
    const middleWareInit = (req: IRequest, res: IResponse, next: INext) =>
      this._subscription.checkSubscription(req, res, next);

    router.get('/', middleWareInit, (req, res, next) =>
      this._controller.getLibraryContentPath(req, res).catch(next),
    );
    router.post('/', middleWareInit, (req, res, next) =>
      this._controller.getLibraryObject(req, res).catch(next),
    );
    router.put('/', middleWareInit, (req, res, next) =>
      this._controller.putLibraryObject(req, res).catch(next),
    );
    router.delete('/', middleWareInit, (req, res, next) =>
      this._controller.deleteLibraryObject(req, res).catch(next),
    );
    router.post('/reorder', middleWareInit, (req, res, next) =>
      this._controller.reorderLibraryObject(req, res).catch(next),
    );
    router.post('/move', middleWareInit, (req, res, next) =>
      this._controller.moveLibraryObject(req, res).catch(next),
    );
    router.post('/rename', middleWareInit, (req, res, next) =>
      this._controller.renameLibraryObject(req, res).catch(next),
    );
    router.delete('/folder_in_out', middleWareInit, (req, res, next) =>
      this._controller.deleteFolderMoving(req, res).catch(next),
    );
    router.get('/last_played', middleWareInit, (req, res, next) =>
      this._controller.getLastPlayedItem(req, res).catch(next),
    );
    router.post('/bookmarks', middleWareInit, (req, res, next) =>
      this._controller.getAllUserBookmarks(req, res).catch(next),
    );
    router.get('/bookmarks', middleWareInit, (req, res, next) =>
      this._controller.getAllUserBookmarks(req, res).catch(next),
    );
    router.put('/bookmark', middleWareInit, (req, res, next) =>
      this._controller.upsertBookmark(req, res).catch(next),
    );
    router.post('/thumbnail_set', middleWareInit, (req, res, next) =>
      this._controller.itemThumbnailPutRequest(req, res).catch(next),
    );
    router.get('/keys', middleWareInit, (req, res, next) =>
      this._controller.getUserLibraryKeys(req, res).catch(next),
    );
    router.post('/uuids', middleWareInit, (req, res, next) =>
      this._controller.postLibraryUuids(req, res).catch(next),
    );
    return router;
  }
}
