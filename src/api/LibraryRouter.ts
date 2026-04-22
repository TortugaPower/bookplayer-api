import express from 'express';
import { LibraryController } from '../controllers/LibraryController';
import { checkSubscription } from './middlewares/subscription';

const LibraryRouter = express.Router();
const controller = new LibraryController();

LibraryRouter.get('/', checkSubscription, (req, res, next) =>
  controller.getLibraryContentPath(req, res).catch(next),
);
LibraryRouter.post('/', checkSubscription, (req, res, next) =>
  controller.getLibraryObject(req, res).catch(next),
);
LibraryRouter.put('/', checkSubscription, (req, res, next) =>
  controller.putLibraryObject(req, res).catch(next),
);
LibraryRouter.delete('/', checkSubscription, (req, res, next) =>
  controller.deleteLibraryObject(req, res).catch(next),
);
LibraryRouter.post('/reorder', checkSubscription, (req, res, next) =>
  controller.reorderLibraryObject(req, res).catch(next),
);
LibraryRouter.post('/move', checkSubscription, (req, res, next) =>
  controller.moveLibraryObject(req, res).catch(next),
);
LibraryRouter.post('/rename', checkSubscription, (req, res, next) =>
  controller.renameLibraryObject(req, res).catch(next),
);
LibraryRouter.delete('/folder_in_out', checkSubscription, (req, res, next) =>
  controller.deleteFolderMoving(req, res).catch(next),
);
LibraryRouter.get('/last_played', checkSubscription, (req, res, next) =>
  controller.getLastPlayedItem(req, res).catch(next),
);
LibraryRouter.post('/bookmarks', checkSubscription, (req, res, next) =>
  controller.getAllUserBookmarks(req, res).catch(next),
);
LibraryRouter.get('/bookmarks', checkSubscription, (req, res, next) =>
  controller.getAllUserBookmarks(req, res).catch(next),
);
LibraryRouter.put('/bookmark', checkSubscription, (req, res, next) =>
  controller.upsertBookmark(req, res).catch(next),
);
LibraryRouter.post('/thumbnail_set', checkSubscription, (req, res, next) =>
  controller.itemThumbnailPutRequest(req, res).catch(next),
);
LibraryRouter.get('/keys', checkSubscription, (req, res, next) =>
  controller.getUserLibraryKeys(req, res).catch(next),
);
LibraryRouter.post('/uuids', checkSubscription, (req, res, next) =>
  controller.postLibraryUuids(req, res).catch(next),
);

export default LibraryRouter;
