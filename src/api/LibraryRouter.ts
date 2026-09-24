import express from 'express';
import { LibraryController } from '../controllers/LibraryController';
import { recordSyncOperation } from './middlewares/recordSyncOperation';
import { checkSubscription, requireSubscription } from './middlewares/subscription';
import { SubscriptionTierEnum } from '../types/user';
import { validateBody } from '../validation/validate';
import {
  putExternalResourceSchema,
  deleteExternalResourceSchema,
} from '../validation/externalResource';
import { putItemSchema, updateItemSchema } from '../validation/libraryItem';
import {
  startUploadSchema,
  partUrlsSchema,
  completeUploadSchema,
  abortUploadSchema,
} from '../validation/multipartUpload';

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
LibraryRouter.post('/', checkSubscription, validateBody(updateItemSchema), requireCloudData, (req, res, next) =>
  controller.getLibraryObject(req, res).catch(next),
);
LibraryRouter.put('/', checkSubscription, validateBody(putItemSchema), requireCloudData, (req, res, next) =>
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
// Multipart uploads of a book's file. S3 is PRO-only, and the key is always
// derived from the caller's own row. See MultipartUploadService.
LibraryRouter.post('/upload/start', checkSubscription, validateBody(startUploadSchema), requireS3Upload, (req, res, next) =>
  controller.startUpload(req, res).catch(next),
);
LibraryRouter.post('/upload/parts', checkSubscription, validateBody(partUrlsSchema), requireS3Upload, (req, res, next) =>
  controller.getUploadPartUrls(req, res).catch(next),
);
LibraryRouter.get('/upload/parts', checkSubscription, requireS3Upload, (req, res, next) =>
  controller.listUploadParts(req, res).catch(next),
);
LibraryRouter.post('/upload/complete', checkSubscription, validateBody(completeUploadSchema), requireS3Upload, (req, res, next) =>
  controller.completeUpload(req, res).catch(next),
);
LibraryRouter.post('/upload/abort', checkSubscription, validateBody(abortUploadSchema), requireS3Upload, (req, res, next) =>
  controller.abortUpload(req, res).catch(next),
);
LibraryRouter.get('/keys', checkSubscription, requireCloudData, (req, res, next) =>
  controller.getUserLibraryKeys(req, res).catch(next),
);
LibraryRouter.post('/uuids', checkSubscription, requireCloudData, (req, res, next) =>
  controller.postLibraryUuids(req, res).catch(next),
);

export default LibraryRouter;
