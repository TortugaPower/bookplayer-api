import express from 'express';
import { LibraryController } from '../controllers/LibraryController';
import { recordSyncOperation } from './middlewares/recordSyncOperation';
import { checkSubscription, requireSubscription } from './middlewares/subscription';
import { SubscriptionTierEnum } from '../types/user';
import { validateBody } from '../validation/validate';
import {
  putExternalResourceSchema,
  deleteExternalResourceSchema,
  itemPutRequestSchema,
} from '../validation/externalResource';

const LibraryRouter = express.Router();
const controller = new LibraryController();

// Audit every state-mutating library request (fire-and-forget, gated by
// SYNC_AUDIT_ENABLED). Must run before the route handlers so it can wrap the
// response. See docs/sync-operations-audit-plan.md.
LibraryRouter.use(recordSyncOperation);

// Cloud data access. PRO has full cloud; LITE (not built yet) syncs DB data
// only. S3 download/upload URLs embedded in these responses are further gated
// to PRO inline in LibraryService (lite gets metadata with url: null). Runs
// after checkSubscription (which populates req.user.subscriptions) and falls
// back to a live RC check before denying — so a just-upgraded or mis-resolved
// PRO user still passes. PLUS/FREE have no cloud access → 403.
const requireCloudData = requireSubscription([
  SubscriptionTierEnum.PRO,
  SubscriptionTierEnum.LITE,
]);
// Endpoints whose sole purpose is to mint an S3 upload URL. PRO only — LITE has
// no hosted files in our S3.
const requireS3Upload = requireSubscription([SubscriptionTierEnum.PRO]);

LibraryRouter.get('/', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getLibraryContentPath(req, res).catch(next),
);
LibraryRouter.post('/', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getLibraryObject(req, res).catch(next),
);
LibraryRouter.put('/', checkSubscription, requireCloudData, (req, res, next) =>
  controller.putLibraryObject(req, res).catch(next),
);
LibraryRouter.put('/external', checkSubscription, validateBody(putExternalResourceSchema), requireCloudData, (req, res, next) =>
  controller.putExternalResource(req, res).catch(next),
);
LibraryRouter.delete('/external', checkSubscription, validateBody(deleteExternalResourceSchema), requireCloudData, (req, res, next) =>
  controller.deleteExternalResource(req, res).catch(next),
);
LibraryRouter.delete('/', checkSubscription, requireCloudData, (req, res, next) =>
  controller.deleteLibraryObject(req, res).catch(next),
);
LibraryRouter.post('/reorder', checkSubscription, requireCloudData, (req, res, next) =>
  controller.reorderLibraryObject(req, res).catch(next),
);
LibraryRouter.post('/move', checkSubscription, requireCloudData, (req, res, next) =>
  controller.moveLibraryObject(req, res).catch(next),
);
LibraryRouter.post('/rename', checkSubscription, requireCloudData, (req, res, next) =>
  controller.renameLibraryObject(req, res).catch(next),
);
LibraryRouter.delete('/folder_in_out', checkSubscription, requireCloudData, (req, res, next) =>
  controller.deleteFolderMoving(req, res).catch(next),
);
LibraryRouter.get('/last_played', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getLastPlayedItem(req, res).catch(next),
);
LibraryRouter.post('/bookmarks', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getAllUserBookmarks(req, res).catch(next),
);
LibraryRouter.get('/bookmarks', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getAllUserBookmarks(req, res).catch(next),
);
LibraryRouter.put('/bookmark', checkSubscription, requireCloudData, (req, res, next) =>
  controller.upsertBookmark(req, res).catch(next),
);
LibraryRouter.post('/thumbnail_set', checkSubscription, requireS3Upload, (req, res, next) =>
  controller.itemThumbnailPutRequest(req, res).catch(next),
);
LibraryRouter.post('/external_set', checkSubscription, validateBody(itemPutRequestSchema), requireS3Upload, (req, res, next) =>
  controller.itemPutRequest(req, res).catch(next),
);
LibraryRouter.get('/keys', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getUserLibraryKeys(req, res).catch(next),
);
LibraryRouter.post('/uuids', checkSubscription, requireCloudData, (req, res, next) =>
  controller.postLibraryUuids(req, res).catch(next),
);

export default LibraryRouter;
