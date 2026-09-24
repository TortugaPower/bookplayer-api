import { IRequest, IResponse } from '../types/http';
import { LibraryService } from '../services/LibraryService';
import { logger } from '../services/LoggerService';
import { LibraryDB } from '../services/db/LibraryDB';
import { Bookmark, LibraryItem } from '../types/user';
import { isValidUUID } from '../utils';
import {
  PutExternalResourceBody,
  DeleteExternalResourceBody,
} from '../validation/externalResource';
import { MultipartUploadService } from '../services/MultipartUploadService';
import { UploadError } from '../types/multipartUpload';
import {
  AbortUploadBody,
  CompleteUploadBody,
  ListPartsQuery,
  PartUrlsBody,
  StartUploadBody,
  listPartsQuerySchema,
} from '../validation/multipartUpload';

// Query-string flags arrive as strings; `?sign=false` must not read as true.
// Strict on purpose. Every shipped client sends the literal `true`: iOS
// interpolates a Swift Bool (unchanged since 2023-02), Android's Retrofit
// encodes a Kotlin Boolean, and the web app URL-encodes a JS boolean and
// hard-codes `sign=true` on /last_played. There is no other spelling to accept.
const isTrue = (value: unknown): boolean =>
  value === true || value === 'true' || value === '1';

export class LibraryController {
  private readonly _logger = logger;

  constructor(
    private _libraryService: LibraryService = new LibraryService(),
    private _libraryDB: LibraryDB = new LibraryDB(),
    private _multipartUploadService: MultipartUploadService = new MultipartUploadService(),
  ) {}

  public async getUserLibraryKeys(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const content = await this._libraryDB.getAllKeys(user.id_user);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.getUserLibraryKeys', message: err.message, data: { user: req.user } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getLibraryContentPath(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, uuid, sign, noLastItemPlayed, forceLastItem } = req.query;
      // qs turns `?uuid=a&uuid=b` or `?relativePath[]=x` into arrays; an array
      // string-coerces past isValidUUID and then fails as a DB binding, which
      // would now surface as a 500. That is a malformed request, not a server
      // fault, so reject it up front.
      if (
        (relativePath != null && typeof relativePath !== 'string') ||
        (uuid != null && typeof uuid !== 'string')
      ) {
        res.status(422).json({ message: 'Invalid query parameters' });
        return;
      }
      const user = req.user;
      // `uuid` names the item; a trailing slash on `relativePath` asks for its
      // contents. See LibraryService.getLibrary for the resolution rules.
      const path = `${user.email}/${relativePath ? relativePath : ''}`;

      const options = {
        withPresign: isTrue(sign),
        appVersion: req.app_version,
      };
      const content = await this._libraryService.getLibrary(user, path, options, uuid);
      const payload: { content: LibraryItem[]; lastItemPlayed?: LibraryItem | null } = { content };
      if (
        ((!relativePath || relativePath === '/' || relativePath === '') &&
          !isTrue(noLastItemPlayed)) ||
        isTrue(forceLastItem)
      ) {
        // The resume item rides along with the root listing, and the listing
        // has already succeeded by now. A failure confined to the resume item
        // must not fail the whole root sync: log it and omit the key. `null`
        // keeps meaning "nothing played yet"; an absent key means "unavailable
        // this time". /last_played remains the strict, 500-on-failure route.
        try {
          payload.lastItemPlayed = await this._libraryService.getLastItemPlayed(user, options);
        } catch (err) {
          this._logger.log(
            { origin: 'LibraryController.getLibraryContentPath', message: `lastItemPlayed failed: ${err.message}`, data: { user_id: user.id_user, step: 'lastItemPlayed' } },
            'error',
          );
        }
      }
      return res.json(payload);
    } catch (err) {
      // Identifiers only: `req.user` carries the email and subscription state.
      this._logger.log({ origin: 'LibraryController.getLibraryContentPath', message: err.message, data: { user_id: req.user?.id_user, query: req.query } }, 'error');
      // Anything thrown here is a server-side failure (DB read, presign,
      // prefix resolution) — there is no request validation on this path that
      // throws. Answer 5xx so clients treat it as retryable rather than as a
      // permanent client error, per the controller pattern in CLAUDE.md. The
      // message stays generic on purpose: iOS echoes it in an alert, and a
      // specific "library unavailable" reads as data loss to a user.
      res.status(500).json({ message: 'Internal error' });
      return;
    }
  }

  public async getLastPlayedItem(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { sign } = req.query;
      const user = req.user;
      const lastItemPlayed = await this._libraryService.getLastItemPlayed(user, {
        withPresign: isTrue(sign),
        appVersion: req.app_version,
      });
      return res.json({ lastItemPlayed });
    } catch (err) {
      // Same mapping as getLibraryContentPath: nothing thrown here is a client
      // mistake, so answer a generic 5xx and keep identifiers only in the log.
      this._logger.log({ origin: 'LibraryController.getLastPlayedItem', message: err.message, data: { user_id: req.user?.id_user, query: req.query } }, 'error');
      res.status(500).json({ message: 'Internal error' });
      return;
    }
  }

  public async getLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, uuid } = req.body;
      const user = req.user;

      // Body validated by validateBody(updateItemSchema) at the route, which
      // also strips server-owned columns such as `source_path`.
      const updateFields = Object.keys(req.body).filter(
        (key) => key !== 'relativePath' && key !== 'originalFileName' && key !== 'uuid',
      );

      if (updateFields.length) {
        const updateObj = updateFields.reduce(
          (obj: { [key: string]: unknown }, key) => {
            obj[key] = req.body[key];
            return obj;
          },
          {},
        );
        await this._libraryService.updateObject(
          user,
          relativePath,
          updateObj as unknown as LibraryItem,
          uuid,
        );
      }

      return res.json({ content: { url: null } });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.getLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async putLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const content = (await this._libraryService.putObject(user, params)) ?? {};
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.putLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(err.statusCode || 400).json({ message: err.message });
      return;
    }
  }

  public async putExternalResource(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      // Body validated by validateBody(putExternalResourceSchema) at the route.
      const { uuid, ...externalResource } = req.body as PutExternalResourceBody;

      const content = (await this._libraryService.putExternalResource(user, uuid, externalResource)) ?? {};
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.putExternalResource', message: err.message, data: { id_user: req.user?.id_user, uuid: req.body?.uuid } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async deleteExternalResource(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      // Body validated by validateBody(deleteExternalResourceSchema) at the route.
      const { uuid, providerId, providerName } = req.body as DeleteExternalResourceBody;

      const content = (await this._libraryService.deleteExternalResource(user, uuid, providerId, providerName)) ?? {};
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.deleteExternalResource', message: err.message, data: { id_user: req.user?.id_user, uuid: req.body?.uuid } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async deleteLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const content = await this._libraryService.deleteObject(user, params);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.deleteLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async moveLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const { origin, destination } = params;
      const useUuids = (isValidUUID(origin) && isValidUUID(destination))
        || (isValidUUID(origin) && destination === '')
        || (isValidUUID(destination) && origin === '');
      const content = useUuids
        ? await this._libraryService.moveLibraryObjectByUuid(user, params)
        : await this._libraryService.moveLibraryObject(user, params);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.moveLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async deleteFolderMoving(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, uuid } = req.body;
      const user = req.user;
      let folderPath: string | undefined = relativePath;
      if (isValidUUID(uuid)) {
        const items = await this._libraryDB.getLibraryByUuid(user.id_user, uuid, {
          exactly: true,
        });
        const item = items?.[0];
        if (!item) {
          throw new Error('Invalid folder');
        }
        folderPath = item.key;
      } else if (!relativePath) {
        throw new Error('Invalid folder');
      }
      const success = await this._libraryService.deleteFolderMoving(user, folderPath);
      return res.json({ success });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.deleteFolderMoving', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getAllUserBookmarks(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const { relativePath, uuid } = req.method === 'POST' ? req.body : req.query;
      const bookmarks = await this._libraryDB.getBookmarks({
        user_id: user.id_user,
        key: relativePath,
        uuid: uuid,
      });
      const response: { bookmarks: Bookmark[]; warning?: string } = {
        bookmarks,
      };
      if (req.method === 'POST') {
        response.warning =
          'DEPRECATED: Using POST for /library/bookmarks is deprecated and ' +
          'will be removed in the future. Please use GET.';
        console.error(response.warning, user.id_user);
      }
      return res.json(response);
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.getAllUserBookmarks', message: err.message, data: { user: req.user, body: req.body, query: req.query } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async upsertBookmark(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const bookmark = req.body as Bookmark;
      const itemDB = isValidUUID(bookmark.uuid)
        ? await this._libraryDB.getLibraryByUuid(user.id_user, bookmark.uuid, {
          exactly: true,
        })
        : await this._libraryDB.getLibrary(user.id_user, bookmark.key, {
          exactly: true,
        });
      if (!itemDB || !itemDB[0]) {
        throw new Error('Invalid key');
      }
      bookmark.library_item_id = itemDB[0].id_library_item;
      const inserted = await this._libraryDB.upsertBookmark(bookmark);
      if (!inserted) {
        throw new Error('problem creating the bookmark');
      }
      return res.json({
        bookmark: {
          ...inserted,
          title: itemDB[0].title,
          relativePath: itemDB[0].key,
        },
      });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.upsertBookmark', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async itemThumbnailPutRequest(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const thumbnailData = req.body as {
        thumbnail_name: string;
        relativePath: string;
        uuid?: string;
        uploaded?: boolean;
      };
      if (!thumbnailData.thumbnail_name || !thumbnailData.relativePath) {
        throw new Error('Invalid parameters');
      }
      const url = await this._libraryService.thumbnailPutRequest(user, thumbnailData);
      if (!url) {
        throw new Error('problem creating the request url');
      }
      return res.json({
        thumbnail_name: thumbnailData.thumbnail_name,
        thumbnail_url: !thumbnailData.uploaded ? url : '',
        uploaded: thumbnailData.uploaded && url,
      });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.itemThumbnailPutRequest', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async renameLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, uuid, newName } = req.body;
      if ((!relativePath && !uuid) || !newName) {
        throw new Error('Invalid parameters');
      }
      const user = req.user;
      const cleanPath = (relativePath || '').replace(`${user.email}/`, '');
      const objectDB = isValidUUID(uuid)
        ? await this._libraryDB.getLibraryByUuid(user.id_user, uuid, { exactly: true })
        : await this._libraryDB.getLibrary(user.id_user, cleanPath, {
          exactly: true,
        });
      const itemDb = objectDB[0];
      if (!itemDb) {
        throw Error('Item not found');
      }
      const content = await this._libraryService.renameLibraryObject(user, {
        item: itemDb,
        newName,
      });
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.renameLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async postLibraryUuids(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const MAX_RECORDS_LIMIT = 1000;
      const user = req.user;
      const processData = req.body as {
        items: Record<string, string>;
      };
      if (Object.keys(processData.items).length > MAX_RECORDS_LIMIT) throw new Error(`Too many records, the maximum to process at a time is ${MAX_RECORDS_LIMIT}.`);

      const updates = Object.keys(processData.items).map((key) => ({ key, uuid: processData.items[key] }));
      const { applied, conflicts } = await this._libraryService.processItemUUIDs(user, updates);
      // Return both the successes and the conflicts so the client can patch its local DB
      return res.json({ applied, conflicts });
    } catch (err) {
      this._logger.log({ origin: 'LibraryController.postLibraryUuids', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  // MARK: - Multipart uploads (/upload/*)
  // Bodies are validated at the route. An UploadError's code goes out as `error`,
  // the stable code the clients branch on; anything else is a 500 they retry.

  public async startUpload(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const body = req.body as StartUploadBody;
      const result = await this._multipartUploadService.startUpload(req.user, body);
      return res.json(result);
    } catch (err) {
      return this.sendUploadError(res, err, 'LibraryController.startUpload', req);
    }
  }

  public async getUploadPartUrls(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const body = req.body as PartUrlsBody;
      const parts = await this._multipartUploadService.getPartUrls(req.user, body);
      return res.json({ parts });
    } catch (err) {
      return this.sendUploadError(res, err, 'LibraryController.getUploadPartUrls', req);
    }
  }

  public async listUploadParts(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const parsed = listPartsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(422).json({
          message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
          error: 'invalid_request',
        });
      }
      const query = parsed.data as ListPartsQuery;
      const parts = await this._multipartUploadService.listParts(req.user, query);
      return res.json({ parts });
    } catch (err) {
      return this.sendUploadError(res, err, 'LibraryController.listUploadParts', req);
    }
  }

  public async completeUpload(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const body = req.body as CompleteUploadBody;
      await this._multipartUploadService.completeUpload(req.user, body);
      return res.json({ synced: true });
    } catch (err) {
      return this.sendUploadError(res, err, 'LibraryController.completeUpload', req);
    }
  }

  public async abortUpload(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const body = req.body as AbortUploadBody;
      await this._multipartUploadService.abortUpload(req.user, body);
      return res.json({ aborted: true });
    } catch (err) {
      return this.sendUploadError(res, err, 'LibraryController.abortUpload', req);
    }
  }

  private sendUploadError(
    res: IResponse,
    err: Error,
    origin: string,
    req: IRequest,
  ): IResponse {
    const uuid = req.body?.uuid ?? req.query?.uuid;
    if (err instanceof UploadError) {
      this._logger.log(
        { origin, message: err.message, data: { id_user: req.user?.id_user, uuid, code: err.code } },
        'warn',
      );
      return res
        .status(err.statusCode)
        .json({ message: err.message, error: err.code, ...(err.details ?? {}) });
    }
    this._logger.log(
      { origin, message: err.message, data: { id_user: req.user?.id_user, uuid } },
      'error',
    );
    return res.status(500).json({ message: 'Internal error' });
  }
}
