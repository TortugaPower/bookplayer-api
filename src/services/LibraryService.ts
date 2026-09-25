import {
  Bookmark,
  LibraryItemDB,
  LibraryItemMovedDB,
  LibraryItem,
  LibraryItemOutput,
  LibraryItemType,
  StorageAction,
  User,
  ItemMatchPayload,
  MatchUuidsResult,
  ExternalResource,
  ExternalResourceDb,
  SubscriptionTierEnum
} from '../types/user';
import { Knex } from 'knex';
import database from '../database';
import { StorageService } from './StorageService';
import { logger } from './LoggerService';
import moment from 'moment-timezone';
import {
  splitArrayGroups,
  detectExcessiveFolderNesting,
  sanitizeLibraryPath,
  isValidUUID,
} from '../utils';
import { LibraryDB, externalResourceRowToApi } from './db/LibraryDB';
import { StoragePrefixService } from './StoragePrefixService';
import { GlacierRestoreService } from './GlacierRestoreService';
import { ApiError, ApiErrorCode } from '../types/apiError';

/**
 * A library read that could not be answered because the DB layer failed (it
 * logs and returns `null`). Distinct from "nothing matched" (`[]`) so the
 * controller can report a retryable server error instead of an empty library.
 */
export class LibraryLookupError extends Error {
  constructor(message = 'Library lookup failed') {
    super(message);
    this.name = 'LibraryLookupError';
  }
}

/** `thumbnailPutRequest`'s answer for an item the user deleted: nothing to set. */
export const ITEM_DELETED = Symbol('ITEM_DELETED');

export class LibraryService {
  private readonly _logger = logger;
  private db = database;
  private _glacier = new GlacierRestoreService();

  constructor(
    private _storage: StorageService = new StorageService(),
    private _libraryDB: LibraryDB = new LibraryDB(),
    private _prefix: StoragePrefixService = new StoragePrefixService(),
  ) {}

  async parseLibraryItemDb(
    item: LibraryItemDB | LibraryItem,
    output: LibraryItemOutput,
  ): Promise<LibraryItemDB | LibraryItem> {
    let parsed: LibraryItem | LibraryItemDB;
    switch (output) {
      case LibraryItemOutput.API:
        const itemTemp = item as LibraryItemDB;
        parsed = {
          relativePath: itemTemp.key,
          originalFileName: itemTemp.original_filename,
          title: itemTemp.title,
          details: itemTemp.details,
          speed: itemTemp.speed,
          currentTime: itemTemp.actual_time
            ? parseFloat(itemTemp.actual_time)
            : 0,
          duration: parseFloat(itemTemp.duration),
          percentCompleted: itemTemp.percent_completed,
          isFinished: itemTemp.is_finish,
          orderRank: itemTemp.order_rank || 0,
          lastPlayDateTimestamp: itemTemp.last_play_date,
          type: itemTemp.type,
          thumbnail: itemTemp.thumbnail,
          // null, not '': iOS decodes this as URL? and an empty string fails
          // decoding, permanently wedging the upload retry loop
          url: null,
          synced: itemTemp.synced,
          source_path: itemTemp.source_path,
          uuid: itemTemp.uuid,
        };
        break;
      case LibraryItemOutput.DB:
        const itemApi = item as LibraryItem;
        parsed = {
          key: itemApi.relativePath,
          title: itemApi.title,
          original_filename: itemApi.originalFileName,
          speed:
            itemApi.speed != null
              ? parseFloat(`${itemApi.speed || 1}`)
              : undefined,
          details: itemApi.details,
          actual_time:
            itemApi.currentTime != null ? `${itemApi.currentTime}` : undefined,
          duration: !!itemApi.duration ? `${itemApi.duration}` : undefined,
          percent_completed:
            itemApi.percentCompleted != null
              ? parseFloat(`${itemApi.percentCompleted || 0}`)
              : undefined,
          order_rank:
            itemApi.orderRank != null
              ? parseInt(`${itemApi.orderRank}`)
              : undefined,
          last_play_date:
            !!itemApi.lastPlayDateTimestamp &&
            `${itemApi.lastPlayDateTimestamp}`.trim() !== ''
              ? parseInt(`${itemApi.lastPlayDateTimestamp}`)
              : undefined,
          type: itemApi.type,
          is_finish: itemApi.isFinished,
          thumbnail: itemApi.thumbnail,
          synced: itemApi.synced !== undefined ? itemApi.synced : undefined,
          source_path: itemApi.source_path,
          uuid: itemApi.uuid,
        };
        break;
    }
    return parsed;
  }

  /**
   * Resolves `GET /v1/library`. See the resolution contract inside.
   *
   * @throws {LibraryLookupError} when a DB read fails. Deliberate departure
   * from the "return null on error" service convention: an empty result is
   * authoritative to sync clients, so a failed read must never look like one.
   * Controllers map it to 500.
   */
  async getLibrary(
    user: User,
    path: string,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
    uuid?: string,
  ): Promise<LibraryItem[]> {
    // The controller prefixes the client's relativePath with the account email
    // (legacy key layout); strip it once here so nothing below — including the
    // failure log — has to carry the email around.
    const cleanPath = path.replace(`${user.email}/`, '');
    try {
      // Resolution contract: `uuid` identifies the item; a trailing slash on
      // `relativePath` asks for its contents. A valid uuid is authoritative —
      // it is looked up on its own and never falls back to the path, because
      // the path is exactly what goes stale when a folder is moved or renamed.
      // When the uuid resolves to a container (folder or bound book) and the
      // caller asked for contents, the children are listed by the container's
      // *server-side* key, so a client still holding the pre-rename path gets
      // the right listing. Without a uuid (or with a malformed one, as every
      // iOS build before 2026-09 sent) the path lookup behaves as it always has;
      // the empty path (library root) is only meaningful there.
      //
      // The DB layer returns `null` when a query fails and `[]` when nothing
      // matches. Those must not collapse into the same response: an empty
      // listing is authoritative to sync clients (it is what they reconcile
      // deletions against), so a lookup failure is raised instead and reaches
      // the controller's error path rather than a 200 with an empty library.
      const wantsContents = cleanPath.endsWith('/');
      let objectDB: LibraryItemDB[];
      if (isValidUUID(uuid)) {
        const owner = this.requireLookup(
          await this._libraryDB.getLibraryByUuid(user.id_user, uuid),
        )[0];
        // Not found → []. Safe: the requests that reconcile deletions never
        // carry a uuid (both apps list by path), and the one uuid-bearing
        // contents request — the iOS bound-book download — treats an empty
        // list as a failed download, not as an empty folder.
        if (!owner) return [];
        // Positive classification: a NULL or unknown `type` (legacy rows) is
        // not a container and returns the row, as it always has.
        const ownerType = parseInt(`${owner.type}`);
        const isContainer =
          ownerType === parseInt(LibraryItemType.FOLDER) ||
          ownerType === parseInt(LibraryItemType.BOUND);
        objectDB =
          wantsContents && isContainer
            ? this.requireLookup(
                await this._libraryDB.getLibrary(user.id_user, `${owner.key}/`),
              )
            : [owner];
      } else {
        objectDB = this.requireLookup(
          await this._libraryDB.getLibrary(user.id_user, cleanPath),
        );
      }

      if (!objectDB || objectDB.length <= 0) return []

      // Same rule as the item lookups: a failed links query must not read as
      // "no links". Both apps reconcile each item's local server links against
      // this list and delete the ones missing from it.
      const externals = this.requireLookup(
        await this._libraryDB.getExternalResources(
          objectDB.map((ob) => ob.id_library_item),
        ),
      );
      const externalsMp = externals.reduce((acc, source) => {
        const libId = source.library_item_id;
        
        if (!acc[libId]) {
          acc[libId] = [];
        }
        
        acc[libId].push(source);
        return acc;
      }, {} as Record<number, ExternalResourceDb[]>);

      const library: LibraryItem[] = [];
      const storagePrefix = options.withPresign
        ? await this._prefix.getPrefix(user)
        : null;
      // On-demand thaw (GlacierRestoreService): only when this request names
      // ONE item the client is about to play or download — a path without a
      // trailing slash that is not the root (`''` is the root listing, which has
      // no slash either) resolving to a single row that is not a plain folder
      // (a book, a bound book, or a legacy row with a NULL type — those get a
      // URL too) — on the presigned branch every shipped app uses, for a PRO
      // user (the only tier with S3 files). Listings never HEAD, even a root
      // with one item.
      const single = objectDB.length === 1 ? objectDB[0] : null;
      const tapped =
        single &&
        cleanPath !== '' &&
        !wantsContents &&
        parseInt(`${single.type}`) !== parseInt(LibraryItemType.FOLDER) &&
        storagePrefix &&
        user.subscriptions?.includes(SubscriptionTierEnum.PRO) &&
        !['2023-10-29', 'latest'].includes(options.appVersion)
          ? single
          : null;
      const storageState = tapped
        ? await this._glacier.ensureRetrievable(user, tapped, storagePrefix)
        : undefined;
      for (let index = 0; index < objectDB.length; index++) {
        const itemDb = objectDB[index];
        let fileUrl: string = null;
        let thumbnail: string = null;
        switch (options.appVersion) {
          case '2023-10-29':
          case 'latest':
            fileUrl =
              parseInt(itemDb.type) === parseInt(LibraryItemType.BOOK)
                ? `${process.env.PROXY_FILE_URL}/${encodeURIComponent(
                    itemDb.key,
                  )}`
                : null;
            thumbnail = itemDb.thumbnail
                ? `${
                    process.env.PROXY_FILE_URL
                  }/_thumbnail/${encodeURIComponent(itemDb.thumbnail)}`
                : null;
            break;
          default: // deprecated old part
            if (options.withPresign && user.subscriptions && user.subscriptions.includes(SubscriptionTierEnum.PRO)) {
              const originalFile = itemDb.source_path || itemDb.key;
              const { url } = await this._storage.getPresignedUrl({
                key: `${storagePrefix}/${originalFile}`,
                type: StorageAction.GET,
              });
              fileUrl = url;

              if (itemDb.thumbnail) {
                const { url } = await this._storage.getPresignedUrl({
                  key: `${storagePrefix}_thumbnail/${itemDb.thumbnail}`,
                  type: StorageAction.GET,
                });
                thumbnail = url;
              }
            }
            break;
        }
        const libObj: LibraryItem = {
          uuid: itemDb.uuid,
          relativePath: itemDb.key,
          originalFileName: itemDb.original_filename,
          title: itemDb.title,
          details: itemDb.details,
          speed: itemDb.speed,
          currentTime: itemDb.actual_time
            ? parseFloat(itemDb.actual_time)
            : 0,
          duration: parseFloat(itemDb.duration),
          percentCompleted: itemDb.percent_completed,
          isFinished: itemDb.is_finish,
          orderRank: itemDb.order_rank || 0,
          lastPlayDateTimestamp: itemDb.last_play_date,
          type: itemDb.type,
          url: fileUrl,
          thumbnail,
          synced: itemDb.synced,
          externalResources: (externalsMp[itemDb.id_library_item] ?? []).map(externalResourceRowToApi),
          storageState: itemDb === tapped ? storageState : undefined,
        };
        library.push(libObj);
      }
      return library;
    } catch (err) {
      // A lookup failure was already logged with its cause by the DB layer and
      // is logged with the request by the controller; a third line here would
      // only add volume. Anything else is logged once, with identifiers only —
      // the user object carries the email and subscription state, and the raw
      // `path` is prefixed with the email; neither belongs in the log stream.
      if (!(err instanceof LibraryLookupError)) {
        this._logger.log(
          {
            origin: 'LibraryService.getLibrary',
            message: err.message,
            data: { user_id: user?.id_user, relativePath: cleanPath },
          },
          'error',
        );
      }
      // Re-raised on purpose: the controller answers every thrown failure with
      // a 500 (retryable). Swallowing it here would send clients a 200 with
      // `content: null` / an empty library instead.
      throw err;
    }
  }

  // `null` is the DB layer's "the query failed" (it logs and swallows the
  // driver error); `[]` is "nothing matched". Only the second one is a result.
  private requireLookup<T>(rows: T[] | null): T[] {
    if (rows === null) {
      throw new LibraryLookupError();
    }
    return rows;
  }

  /**
   * A request named an item that has no active row. If the user deleted it
   * (on another device, say), returns true: the request's intent no longer
   * applies, so the caller answers success without changing anything, and the
   * client's next sync removes the item locally. Otherwise no row, active or
   * deleted, has that uuid (or, without a valid uuid, that key): throws
   * `item_not_found`, which the apps stop on and report, instead of retrying
   * something that can never succeed as sent. The key is deliberately not a
   * fallback for a uuid: an old deleted row at the same path can be a
   * different item.
   */
  async confirmDeleted(
    user: User,
    ref: { uuid?: string; key?: string },
    trx?: Knex.Transaction,
  ): Promise<true> {
    const name = isValidUUID(ref.uuid) ? ref.uuid : ref.key;
    if (name) {
      const deleted = await this._libraryDB.hasDeletedItem(user.id_user, ref, trx);
      if (deleted === null) throw new LibraryLookupError();
      if (deleted) return true;
    }
    throw new ApiError(ApiErrorCode.ITEM_NOT_FOUND, 404, `Item not found: "${name}"`);
  }

  async getObject(
    user: User,
    path: string,
    appVersion?: string,
  ): Promise<LibraryItem> {
    try {
      const cleanPath = path.replace(`${user.email}/`, '');
      const objectDB = await this._libraryDB.getLibrary(user.id_user, cleanPath);
      const itemDb = objectDB?.[0];
      if (!itemDb) {
        throw Error('Item not found');
      }
      const libObj = (await this.parseLibraryItemDb(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      let fileUrl = null;
      switch (appVersion) {
        case '2023-10-29':
        case 'latest':
          fileUrl =
            parseInt(itemDb.type) === parseInt(LibraryItemType.BOOK)
              ? `${process.env.PROXY_FILE_URL}/${encodeURIComponent(
                  itemDb.key,
                )}`
              : null;
          break;
        default: // deprecated old part
          if (user.subscriptions && user.subscriptions.includes(SubscriptionTierEnum.PRO)) {
            const originalFile = itemDb.source_path || itemDb.key;
            const storagePrefix = await this._prefix.getPrefix(user);
            const { url, expires_in } = await this._storage.getPresignedUrl({
              key: `${storagePrefix}/${originalFile}`,
              type: StorageAction.GET,
            });
            fileUrl = url;
            libObj.expires_in = expires_in;
          }
          break;
      }
      libObj.url = fileUrl;
      return libObj;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.getObject',
        message: err.message,
        data: { user, path },
      });
      return null;
    }
  }

  async putObject(user: User, params: LibraryItem): Promise<LibraryItem> {
    try {
      const { relativePath } = params;

      // Detect excessive folder nesting with same name
      const nestingCheck = detectExcessiveFolderNesting(relativePath, 5);
      if (nestingCheck.isExcessive) {
        // Log the anomaly and return success without processing
        this._logger.log({
          origin: 'LibraryService.putObject',
          message: `Excessive folder nesting detected and ignored: ${nestingCheck.consecutiveCount} consecutive "${nestingCheck.repeatedFolder}" folders`,
          data: {
            user: { id_user: user.id_user, email: user.email },
            relativePath,
            nestingDetails: {
              repeatedFolder: nestingCheck.repeatedFolder,
              consecutiveCount: nestingCheck.consecutiveCount,
              totalCount: nestingCheck.totalCount,
            },
          },
        });
        // Return null - controller will treat as success
        return null;
      }

      // Parse incoming params into library object
      const libObj = (await this.parseLibraryItemDb(
        params,
        LibraryItemOutput.DB,
      )) as LibraryItemDB;

      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this._libraryDB.getLibrary(user.id_user, cleanPath, {
        exactly: true,
      });
      let itemDb = objectDB[0];
      if (!itemDb) {
        // The key missed, but the client may be re-uploading an item it moved
        // locally (the move never reached us): if the uuid belongs to an
        // existing active item, honor it as a move — inserting would trip
        // library_items_uuid_user_unique and wedge the client's sync queue in
        // an infinite retry.
        itemDb = await this.moveUploadTarget(user, libObj, cleanPath);
      }
      const storagePrefix = await this._prefix.getPrefix(user);
      libObj.source_path = `${process.env.ROOT_FOLDER}/${moment().format(
        'YYYYMMDDHHmmss',
      )}_${libObj.original_filename}`;
      if (itemDb) {
        const fileExists = await this._storage.fileExists({
          key: `${storagePrefix}/${itemDb.source_path || itemDb.key}`,
        });
        if (fileExists === true) {
          const earlyApiResponse = (await this.parseLibraryItemDb(
            itemDb,
            LibraryItemOutput.API,
          )) as LibraryItem;
          
          return earlyApiResponse;
        }
        // Sign where the row says the bytes live. A legacy row (no source_path)
        // is read at its key everywhere else — the synced guard, multipart's
        // resolveTarget, downloads — and this path is never written back to it,
        // so a fresh timestamped path would orphan the upload.
        libObj.source_path = itemDb.source_path || itemDb.key;
      } else {
        itemDb = await this._libraryDB.insertLibraryItem(user.id_user, libObj);
        if (!itemDb) {
          throw new Error(`Failed to create library item at key=${cleanPath}`);
        }
      }

      const apiResponse = (await this.parseLibraryItemDb(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;

      if (!user.subscriptions || !user.subscriptions.includes(SubscriptionTierEnum.PRO)) {
        apiResponse.url = null;
        return apiResponse
      }

      const resourcePath = `${storagePrefix}/${libObj.source_path}`;

      const { url, expires_in } = await this._storage.getPresignedUrl({
        key: resourcePath,
        type: StorageAction.PUT,
      });
      apiResponse.url = url;
      apiResponse.expires_in = expires_in;
      return apiResponse;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.putObject',
        message: err.stack || err.message,
        data: { user, params },
      });
      // Rewrapping in Error(err) drops custom fields; keep errors that carry
      // an HTTP status (e.g. the 409 from moveUploadTarget) intact.
      if (err.statusCode) throw err;
      throw Error(err);
    }
  }

  /**
   * Upload fallback: the requested key has no active row, but the request's
   * uuid may belong to an item the client moved locally. If so, move it (and
   * its subtree for container types) to the new key and return the moved row;
   * returns null when there is nothing to move (normal insert should proceed).
   */
  private async moveUploadTarget(
    user: User,
    incoming: LibraryItemDB,
    newKey: string,
  ): Promise<LibraryItemDB | null> {
    if (!isValidUUID(incoming.uuid)) return null;

    const matches = await this._libraryDB.getLibraryByUuid(
      user.id_user,
      incoming.uuid,
    );
    const existing = matches?.[0];
    if (!existing) return null;
    if (existing.key === newKey) return existing;

    if (parseInt(`${existing.type}`) !== parseInt(`${incoming.type}`)) {
      // Same uuid on a different item type is corrupted client state — don't
      // guess at a move; surface it instead of the opaque insert failure.
      throw new ApiError(
        ApiErrorCode.UUID_CONFLICT,
        409,
        `Upload uuid ${incoming.uuid} belongs to an existing item of a different type at key=${existing.key}`,
      );
    }

    const moveChildren =
      parseInt(`${existing.type}`) !== parseInt(LibraryItemType.BOOK);

    const trx = await this.db.transaction();
    try {
      const moved = await this._libraryDB.moveItemToKey(
        user.id_user,
        existing.id_library_item,
        existing.key,
        newKey,
        moveChildren,
        trx,
      );
      await trx.commit();

      this._logger.log({
        origin: 'LibraryService.moveUploadTarget',
        message: 'Upload uuid matched an item at a different key; treated as move',
        data: {
          id_user: user.id_user,
          uuid: incoming.uuid,
          oldKey: existing.key,
          newKey,
        },
      });

      return moved;
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }

  async deleteObject(user: User, params: LibraryItem): Promise<string[]> {
    try {
      const { relativePath, uuid } = params;
      const deletedObjects = isValidUUID(uuid)
        ? await this._libraryDB.deleteLibraryByUuid({
          user_id: user.id_user,
          uuid,
        })
        : await this._libraryDB.deleteLibrary({
          user_id: user.id_user,
          path: relativePath.replace(`${user.email}/`, ''),
        });
      const itemDb = deletedObjects[0];

      if (!itemDb) {
        const alreadyDeleted = isValidUUID(uuid)
          ? await this._libraryDB.deleteLibraryByUuid({
            user_id: user.id_user,
            uuid,
            active: false,
          })
          : await this._libraryDB.deleteLibrary({
            user_id: user.id_user,
            path: relativePath.replace(`${user.email}/`, ''),
            active: false,
          });
        return alreadyDeleted?.map((i) => i.key) || [];
      }

      const storagePrefix = await this._prefix.getPrefix(user);
      const sourceKeys = deletedObjects.map((item) => {
        const keyPath =
          parseInt(item.type) === parseInt(LibraryItemType.BOOK)
            ? `${item.key}`
            : `${item.key}/`;
        return `${storagePrefix}/${item.source_path || keyPath}`;
      });
      await this.abortInFlightUploads(
        storagePrefix,
        sourceKeys.filter(
          (_, index) =>
            parseInt(deletedObjects[index].type) === parseInt(LibraryItemType.BOOK),
        ),
      );
      for (const sourceKey of sourceKeys) {
        await this._storage.deleteFile({ sourceKey });
      }
      return deletedObjects.map((i) => i.key);
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.deleteObject',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }

  async updateObject(
    user: User,
    relativePath: string,
    params: LibraryItem,
    uuid?: string,
  ): Promise<boolean> {
    try {
      const cleanPath = (relativePath || '').replace(`${user.email}/`, '');

      let updateParams = params;
      if (params.synced === true && (await this.isUnbackedBook(user, cleanPath, uuid))) {
        // `synced` means "the file is in S3", on every tier. Clients before
        // multipart confirm even when S3 rejected the PUT, and LITE clients
        // read `url: null` as "already stored". Keep the rest of the update,
        // drop the confirmation, and answer success: an error would make those
        // clients retry forever.
        const { synced: _dropped, ...rest } = params;
        updateParams = rest as LibraryItem;
        this._logger.log(
          {
            origin: 'LibraryService.updateObject',
            message: 'Ignored synced:true for a book with no object in storage',
            data: { id_user: user.id_user, relativePath: cleanPath, uuid },
          },
          'warn',
        );
      }

      const libraryItem = (await this.parseLibraryItemDb(
        { relativePath, ...updateParams },
        LibraryItemOutput.DB,
      )) as LibraryItemDB;
      const result = await this._libraryDB.updateLibraryItem(
        user.id_user,
        cleanPath,
        libraryItem,
        uuid,
      );

      return result;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.updateObject',
        message: err.message,
        data: { user, relativePath, params },
      });
      throw Error(err);
    }
  }

  /**
   * True only when the item is a book and S3 definitely has no object for it,
   * whatever the caller's tier: a LITE user who was once PRO keeps the files
   * they uploaded then, and those still confirm. An unreachable S3 (null)
   * leaves the old behavior in place rather than stalling uploads that landed.
   */
  private async isUnbackedBook(
    user: User,
    cleanPath: string,
    uuid?: string,
  ): Promise<boolean> {
    const rows = isValidUUID(uuid)
      ? await this._libraryDB.getLibraryByUuid(user.id_user, uuid)
      : await this._libraryDB.getLibrary(user.id_user, cleanPath, { exactly: true });
    const item = rows?.[0];
    if (!item || parseInt(`${item.type}`) !== parseInt(LibraryItemType.BOOK)) {
      return false;
    }
    // Already synced: dropping the confirmation would change nothing, so skip
    // the HEAD older clients' repeat confirmations would otherwise cost.
    if (item.synced) return false;
    const storagePrefix = await this._prefix.getPrefix(user);
    const exists = await this._storage.fileExists({
      key: `${storagePrefix}/${item.source_path || item.key}`,
    });
    return exists === false;
  }

  /**
   * Cancels multipart uploads still in progress for deleted books, so their
   * parts stop billing now instead of when the 7-day lifecycle rule reclaims
   * them. One listing of the user's prefix covers the whole delete, however
   * many books a folder held. Best effort: a failure here must not fail the
   * delete (S3Service logs it and returns null).
   */
  private async abortInFlightUploads(storagePrefix: string, bookKeys: string[]): Promise<void> {
    if (!bookKeys.length) return;
    const deleted = new Set(bookKeys);
    const uploads = await this._storage.listMultipartUploads(`${storagePrefix}/`);
    for (const upload of uploads ?? []) {
      if (deleted.has(upload.key)) {
        await this._storage.abortMultipartUpload(upload.key, upload.uploadId);
      }
    }
  }

  async moveLibraryObject(
    user: User,
    params: { origin: string; destination: string },
  ): Promise<LibraryItemMovedDB[]> {
    const trx = await this.db.transaction();
    try {
      // Sanitize paths to handle whitespace issues in folder names
      const origin = sanitizeLibraryPath(params.origin);
      const destinationPathFolder = sanitizeLibraryPath(params.destination);

      // If origin and destination are the same, return early
      if (origin === destinationPathFolder) {
        await trx.commit();
        return [];
      }

      /// Verify destination folder if not moving to the library
      if (destinationPathFolder !== '') {
        let destinationDB = this.requireLookup(
          await this._libraryDB.getLibrary(
            user.id_user,
            destinationPathFolder,
            { exactly: true },
            trx,
          ),
        );

        if (destinationDB.length === 0) {
          const name = destinationPathFolder.split('/').pop();
          const created = await this._libraryDB.insertLibraryItem(
            user.id_user,
            {
              key: destinationPathFolder,
              title: name,
              original_filename: name,
              speed: 1,
              actual_time: '0',
              details: name,
              duration: `0`,
              percent_completed: 0,
              order_rank: 1,
              last_play_date: null,
              type: LibraryItemType.FOLDER,
              is_finish: false,
              thumbnail: null,
              synced: true,
            },
            trx,
          );
          if (!created) {
            throw new Error(
              `Failed to create destination folder at key=${destinationPathFolder}`,
            );
          }
          destinationDB = [created];
        }
        const destType = `${destinationDB[0].type}`;
        if (
          destType !== LibraryItemType.FOLDER &&
          destType !== LibraryItemType.BOUND
        ) {
          throw Error('The destination is invalid');
        }
      }
      const originObj = this.requireLookup(
        await this._libraryDB.getLibrary(
          user.id_user,
          origin,
          { exactly: true },
          trx,
        ),
      );
      if (originObj.length !== 1) {
        // Check if item already exists at destination (already moved)
        const originFilename = origin.split('/').pop();
        const expectedDestinationPath =
          destinationPathFolder === ''
            ? originFilename
            : `${destinationPathFolder}/${originFilename}`;

        const destinationObj = this.requireLookup(
          await this._libraryDB.getLibrary(
            user.id_user,
            expectedDestinationPath,
            { exactly: true },
            trx,
          ),
        );

        if (destinationObj.length === 1) {
          // Item already moved to destination, return empty array
          await trx.commit();
          return [];
        }

        // Neither at the origin nor at the destination: deleted (nothing to
        // move), or it never existed here (throws item_not_found). Roll back:
        // the destination folder created above was only for this move.
        await this.confirmDeleted(user, { key: origin }, trx);
        await trx.rollback();
        return [];
      }
      const dbMoved = await this._libraryDB.moveFiles(
        user.id_user,
        origin,
        destinationPathFolder,
        trx,
      );

      await this.processMovedFiles(user, dbMoved, trx);

      await trx.commit();
      return dbMoved;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.moveLibraryObject',
        message: err.message,
        data: { user, params },
      });
      if (err instanceof ApiError || err instanceof LibraryLookupError) throw err;
      throw Error(err);
    }
  }

  async moveLibraryObjectByUuid(
    user: User,
    params: { origin: string; destination: string },
  ): Promise<LibraryItemMovedDB[]> {
    const trx = await this.db.transaction();
    try {
      const [originDB] = this.requireLookup(
        await this._libraryDB.getLibraryByUuid(
          user.id_user,
          params.origin,
          null,
          trx,
        ),
      );
      const [destinationDB] = params.destination
        ? this.requireLookup(
            await this._libraryDB.getLibraryByUuid(
              user.id_user,
              params.destination,
              null,
              trx,
            ),
          )
        : [null];

      // A missing origin or destination folder: deleted, so there is nothing
      // to move or nowhere to move it; or never here (throws item_not_found).
      // A named destination that is missing must not fall back to the root.
      if (!originDB || (params.destination && !destinationDB)) {
        await this.confirmDeleted(
          user,
          { uuid: !originDB ? params.origin : params.destination },
          trx,
        );
        await trx.commit();
        return [];
      }

      if (destinationDB) {
        const destType = `${destinationDB.type}`;
        if (
          destType !== LibraryItemType.FOLDER &&
          destType !== LibraryItemType.BOUND
        ) {
          throw Error('The destination is invalid');
        }
      }

      const originFilename = originDB.key.split('/').pop();
      const expectedDestinationPath = !destinationDB
        ? originFilename
        : `${destinationDB.key}/${originFilename}`;

      // If origin and destination are the same, return early
      if (originDB.key === expectedDestinationPath) {
        await trx.commit();
        return [];
      }

      const dbMoved = await this._libraryDB.moveFiles(
        user.id_user,
        originDB.key,
        destinationDB?.key || '',
        trx,
      );

      await this.processMovedFiles(user, dbMoved, trx);

      await trx.commit();
      return dbMoved;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.moveLibraryObjectByUuid',
        message: err.message,
        data: { user, params },
      });
      if (err instanceof ApiError || err instanceof LibraryLookupError) throw err;
      throw Error(err);
    }
  }

  async deleteFolderMoving(user: User, folderPath: string): Promise<boolean> {
    const trx = await this.db.transaction();
    // Sanitize path to handle whitespace issues in folder names
    const sanitizedFolderPath = sanitizeLibraryPath(folderPath);
    try {
      const storagePrefix = await this._prefix.getPrefix(user);
      const folderDB = this.requireLookup(
        await this._libraryDB.getLibrary(
          user.id_user,
          sanitizedFolderPath,
          { exactly: true },
          trx,
        ),
      );
      if (!folderDB[0]) {
        // Folder no longer exists: removing it again is already done
        await trx.commit();
        return true;
      }
      const folderDeleted = await this._libraryDB.deleteLibrary(
        {
          user_id: user.id_user,
          path: sanitizedFolderPath,
          exactly: true,
        },
        trx,
      );
      if (!folderDeleted) {
        throw Error('folder not deleted');
      }
      const dbMoved = await this._libraryDB.moveFilesUp(
        user.id_user,
        sanitizedFolderPath,
        trx,
      );

      // moveFilesUp returns old_key, so the legacy-book S3 relocation is the
      // same shared path every other move flow uses
      await this.processMovedFiles(user, dbMoved, trx);

      const keyPath = `${folderDB[0].key}/`;
      const folderKey = `${storagePrefix}/${folderDB[0].source_path || keyPath}`;
      const folderExist = await this._storage.fileExists({ key: folderKey });
      if (folderExist) {
        await this._storage.deleteFile({ sourceKey: folderKey });
      }

      await trx.commit();
      return true;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.deleteFolderMoving',
        message: err.message,
        data: { user, folderPath },
      });
      if (err instanceof LibraryLookupError) throw err;
      throw Error(err.message);
    }
  }

  /** `null` when the item was deleted: there is nothing left to link. */
  async putExternalResource(user: User, libraryItemUuid: string, externalResource: ExternalResource): Promise<ExternalResource | null> {
    const trx = await this.db.transaction();
    try {
      const [libraryItem] = this.requireLookup(
        await this._libraryDB.getLibraryByUuid(user.id_user, libraryItemUuid, null, trx),
      );

      if (!libraryItem) {
        await this.confirmDeleted(user, { uuid: libraryItemUuid }, trx);
        await trx.rollback();
        return null;
      }

      const existingExternalResource = await this._libraryDB.getExternalResource(libraryItem.id_library_item, externalResource.providerId, externalResource.providerName, trx)
      if (existingExternalResource) {
        // Read-only path — release the connection and return the persisted row
        // so the response shape matches the insert path below.
        await trx.rollback();
        return externalResourceRowToApi(existingExternalResource);
      }

      const insertedRow = await this._libraryDB.insertExternalResource(libraryItem.id_library_item, externalResource, trx)

      if (!insertedRow) {
        throw Error(
          `ExternalResource not inserted: "${JSON.stringify(externalResource)}"`,
        );
      }
      
      await trx.commit();
      return externalResourceRowToApi(insertedRow);
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.putExternalResource',
        message: err.stack || err.message,
        data: { id_user: user.id_user, libraryItemUuid, externalResource },
      });
      throw err;
    }
  }

  async deleteExternalResource(
    user: User,
    libraryItemUuid: string,
    providerId: string,
    providerName: string,
  ): Promise<ExternalResource | null> {
    const trx = await this.db.transaction();
    try {
      const [libraryItem] = this.requireLookup(
        await this._libraryDB.getLibraryByUuid(user.id_user, libraryItemUuid, null, trx),
      );

      // Unlinking asks for "no link": with no item, or no such link, that
      // already holds. Answer success (`null`) instead of an error the apps
      // would retry forever.
      if (!libraryItem) {
        await trx.rollback();
        return null;
      }

      const deletedRow = await this._libraryDB.softDeleteExternalResource(libraryItem.id_library_item, providerId, providerName, trx);

      // A failed write must stay retryable, not read as "already unlinked".
      if (deletedRow === null) throw new LibraryLookupError('External resource unlink failed');
      if (!deletedRow) {
        await trx.rollback();
        return null;
      }

      await trx.commit();
      return externalResourceRowToApi(deletedRow);
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.deleteExternalResource',
        message: err.stack || err.message,
        data: { id_user: user.id_user, libraryItemUuid, providerId, providerName },
      });
      throw err;
    }
  }

  /**
   * @returns `null` only when nothing has been played yet.
   * @throws {LibraryLookupError} when a DB read fails — see getLibrary. Any
   * other failure (presign, prefix resolution) propagates too; the controller
   * maps everything thrown to a 500.
   */
  async getLastItemPlayed(
    user: User,
    options: { withPresign?: boolean; appVersion: string },
    trx?: Knex.Transaction,
  ): Promise<LibraryItem | null> {
    try {
      // The DB class returns `null` when the query failed and `undefined`
      // (knex `.first()`) when nothing has been played yet. Only the second
      // one is the "no resume item" answer.
      const itemDb = await this._libraryDB.getLastItemPlayed(user.id_user, trx);
      if (itemDb === null) throw new LibraryLookupError();
      if (!itemDb) return null;
      const item = (await this.parseLibraryItemDb(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      const externals = this.requireLookup(
        await this._libraryDB.getExternalResources([
          (itemDb as LibraryItemDB).id_library_item,
        ]),
      );
      item.externalResources = externals.map(externalResourceRowToApi);
      switch (options.appVersion) {
        case '2023-10-29':
        case 'latest':
          item.url =
            parseInt(itemDb.type) === parseInt(LibraryItemType.BOOK)
              ? `${process.env.PROXY_FILE_URL}/${encodeURIComponent(
                  itemDb.key,
                )}`
              : null;
          item.thumbnail = itemDb.thumbnail
            ? `${process.env.PROXY_FILE_URL}/_thumbnail/${encodeURIComponent(
                itemDb.thumbnail,
              )}`
            : undefined;
          break;
        default: // deprecated old part
          if (options.withPresign) {
            const originalFile = item.source_path || itemDb.key;
            const storagePrefix = await this._prefix.getPrefix(user);
            const { url, expires_in } = await this._storage.getPresignedUrl({
              key: `${storagePrefix}/${originalFile}`,
              type: StorageAction.GET,
            });
            item.url = url;
            item.expires_in = expires_in;
            // No thaw hook here on purpose: this rides along with every root
            // sync (the apps' hottest request). A frozen resume item fails its
            // first play with a 403, and the player's URL refresh — a
            // single-item request — is where GlacierRestoreService runs.

            if (itemDb.thumbnail) {
              const { url } = await this._storage.getPresignedUrl({
                key: `${storagePrefix}_thumbnail/${itemDb.thumbnail}`,
                type: StorageAction.GET,
              });
              item.thumbnail = url;
            }
          }
          break;
      }
      return item;
    } catch (err) {
      // `null` means "nothing played yet" to the controller. No failure may be
      // mistaken for that — not a failed read (already logged by the DB layer
      // and the controller) and not a presign or prefix failure either — so
      // everything propagates and the controller answers with a 500.
      if (!(err instanceof LibraryLookupError)) {
        this._logger.log(
          {
            origin: 'LibraryService.getLastItemPlayed',
            message: err.message,
            data: { user_id: user?.id_user },
          },
          'error',
        );
      }
      throw err;
    }
  }

  async thumbnailPutRequest(
    user: User,
    params: {
      relativePath: string;
      uuid?: string;
      thumbnail_name: string;
      uploaded?: boolean;
    },
  ): Promise<string | boolean | typeof ITEM_DELETED> {
    try {
      const { relativePath, uuid, thumbnail_name, uploaded } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = this.requireLookup(
        isValidUUID(uuid)
          ? await this._libraryDB.getLibraryByUuid(user.id_user, uuid, {
            exactly: true,
          })
          : await this._libraryDB.getLibrary(user.id_user, cleanPath, {
            exactly: true,
          }),
      );
      const itemDb = objectDB[0];
      if (!itemDb) {
        await this.confirmDeleted(user, { uuid, key: cleanPath });
        return ITEM_DELETED;
      }
      if (uploaded) {
        const idUpdated = await this._libraryDB.updateThumbnail({
          id_library_item: itemDb.id_library_item,
          thumbnail: thumbnail_name,
        });
        return !!idUpdated;
      }
      const storagePrefix = await this._prefix.getPrefix(user);
      const { url } = await this._storage.getPresignedUrl({
        key: `${storagePrefix}_thumbnail/${thumbnail_name}`,
        type: StorageAction.PUT,
      });
      return url;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.thumbnailPutRequest',
        message: err.message,
        data: { user, params },
      });
      if (err instanceof ApiError || err instanceof LibraryLookupError) throw err;
      throw Error(err);
    }
  }

  async renameLibraryObject(
    user: User,
    params: { item: LibraryItemDB; newName: string },
  ): Promise<LibraryItemMovedDB[]> {
    const trx = await this.db.transaction();
    try {
      const { item, newName } = params;
      const itemDb = await this._libraryDB.renameItemTitle(
        {
          user_id: user.id_user,
          id_library_item: item.id_library_item,
          title: newName,
        },
        trx,
      );
      if (parseInt(item.type) === parseInt(LibraryItemType.BOOK)) {
        await trx.commit();
        return [
          {
            id_library_item: itemDb[0].id_library_item,
            key: itemDb[0].key,
            old_key: itemDb[0].key,
            type: itemDb[0].type,
            original_filename: itemDb[0].original_filename,
          },
        ];
      }
      const keyFolders = item.key.split('/');
      const samePrefix = keyFolders.slice(0, keyFolders.length - 1).join('/');
      const destinationPathFolder = `${
        samePrefix === '' ? '' : `${samePrefix}/`
      }${newName}`;
      const destinationDB = await this._libraryDB.getLibrary(
        user.id_user,
        destinationPathFolder,
        { exactly: true },
        trx,
      );
      /// Handle destination folder exists - merge or soft delete origin
      if (!!destinationDB.length) {
        const destination = destinationDB[0];

        // Check if destination is empty (duration='0' or details='0 Files')
        const isDestinationEmpty =
          destination.duration === '0' || destination.details === '0 Files';

        // Check if origin has meaningful data
        const originHasData =
          item.duration !== '0' && item.details !== '0 Files';

        // Only merge if destination is empty AND origin has data
        if (isDestinationEmpty && originHasData) {
          // Merge: Update destination with origin's data
          await this._libraryDB.updateFolderMergeFields(
            {
              id_library_item: destination.id_library_item,
              duration: item.duration,
              details: item.details,
              actual_time: item.actual_time,
              percent_completed: item.percent_completed,
              last_play_date: item.last_play_date,
            },
            trx,
          );
        }

        // Check for nested children and update their keys
        const nestedChildren = await this._libraryDB.getNestedObjects(
          user.id_user,
          item.key,
          trx,
        );

        let movedChildren: LibraryItemMovedDB[] = [];

        if (nestedChildren.length > 0) {
          // Children only: renaming the origin row here would collide it onto
          // the destination key, deactivating the very folder we just merged
          // into. The origin row is soft-deleted below instead.
          movedChildren = await this._libraryDB.moveFolderChildren(
            user.id_user,
            item.key,
            destination.key,
            trx,
          );

          // Process moved children (handle storage operations)
          await this.processMovedFiles(user, movedChildren, trx);
        }

        // Always soft delete origin folder when destination exists
        await this._libraryDB.softDeleteItem(item.id_library_item, trx);

        await trx.commit();

        // Return destination data along with moved children
        return [
          {
            id_library_item: destination.id_library_item,
            key: destination.key,
            old_key: item.key,
            type: destination.type,
            original_filename: destination.original_filename,
            source_path: destination.source_path,
          },
          ...movedChildren,
        ];
      }

      const dbMoved = await this._libraryDB.renameFiles(
        user.id_user,
        item.key,
        destinationPathFolder,
        trx,
      );

      // Process moved files (handle storage operations)
      await this.processMovedFiles(user, dbMoved, trx);

      await trx.commit();
      return dbMoved;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.renameLibraryObject',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }

  async processItemUUIDs(
    user: User,
    updates: ItemMatchPayload[],
  ): Promise<MatchUuidsResult> {
    const trx = await this.db.transaction();

    try {
      const serverKeys = updates.map((u) => u.key);

      const existingItems = await this._libraryDB.selectForUpdateByKeys(
        { user_id: user.id_user, keys: serverKeys },
        trx,
      );

      const existingItemsMap = new Map(
        existingItems.map((item) => [item.key, item.uuid]),
      );

      const conflicts: ItemMatchPayload[] = [];
      const applied: string[] = [];
      const toUpdate: ItemMatchPayload[] = [];

      // Sort into conflicts and safe updates
      for (const item of updates) {
        const currentUuid = existingItemsMap.get(item.key);

        if (currentUuid === undefined || currentUuid === item.uuid) continue;

        if (currentUuid !== null) {
          if (currentUuid !== item.uuid) {
            conflicts.push({ key: item.uuid, uuid: currentUuid });
          }
        } else {
          toUpdate.push(item);
        }
      }

      // Perform updates
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((item) =>
            this._libraryDB.setItemUuid(
              { user_id: user.id_user, key: item.key, uuid: item.uuid },
              trx,
            ),
          ),
        );
        toUpdate.forEach((item) => applied.push(item.uuid));
      }

      await trx.commit();
      return { applied, conflicts };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  // Private helper — moves storage files for library items that were moved in the DB
  private async processMovedFiles(
    user: User,
    movedFiles: LibraryItemMovedDB[],
    trx: Knex.Transaction,
  ): Promise<void> {
    if (!movedFiles) {
      // The key-rewrite wrappers (moveFiles/renameFiles/moveFilesUp/
      // moveFolderChildren) return null on error after logging; throw a real
      // message here instead of letting `.length` below produce an opaque
      // TypeError, so the caller's rollback logs the actual failure point
      throw new Error(
        'processMovedFiles: key rewrite failed (see LibraryDB logs)',
      );
    }
    const storagePrefix = await this._prefix.getPrefix(user);
    const groupCounts = parseInt(`${movedFiles.length / 10}`);
    const groups =
      groupCounts > 1
        ? splitArrayGroups(movedFiles, groupCounts)
        : [movedFiles];

    await Promise.all(
      groups.map(async (group: LibraryItemMovedDB[]) => {
        for (let indexTrx = 0; indexTrx < group.length; indexTrx++) {
          const fileMoved = group[indexTrx];
          if (
            !fileMoved.source_path &&
            parseInt(fileMoved.type) === parseInt(LibraryItemType.BOOK)
          ) {
            const sourceKey = `${storagePrefix}/${fileMoved.old_key}`;
            const original_filename = `${
              process.env.ROOT_FOLDER
            }/${moment().format('YYYYMMDDHHmmss')}_${
              fileMoved.original_filename
            }`;
            const targetKey = `${storagePrefix}/${original_filename}`;
            const isMoved = await this._storage.moveFile({
              sourceKey,
              targetKey,
            });
            // Either way the row must end up naming the object that actually
            // exists. A legacy item (source_path IS NULL) is read back at
            // `${prefix}/${key}`, so once the key rewrite commits, an object
            // still sitting at old_key is unreachable — the row would point at
            // nothing while the bytes are orphaned under the pre-move path.
            //
            // Throwing to roll the rewrite back is not an option: the items
            // relocated earlier in this batch are already at their new keys,
            // and the rollback would strip the source_path that names them,
            // orphaning those instead. So on failure we record where the file
            // really is. The move itself still succeeds — it is a display-path
            // change — and the item stays playable from its legacy key.
            // Where the object is, as best we can establish it.
            let pinnedSourcePath = original_filename;

            if (!isMoved) {
              // A failed move does not locate the bytes on its own. moveFile
              // is copy-then-delete, so the failure may be a copy that never
              // landed (bytes at old_key) or a delete that landed on S3 but
              // lost its response (bytes at the target, source already gone).
              // fileExists also reports 403 as false, so a false is "could not
              // find it", not "it is not there". Probe before concluding.
              const sourceStillThere = await this._storage.fileExists({
                key: sourceKey,
              });
              const targetLanded =
                sourceStillThere === false
                  ? await this._storage.fileExists({ key: targetKey })
                  : null;

              // Anything short of a definitive "source is gone" means the
              // object is, or is presumed, still at the old key — the common
              // case, and the safe default when the probe itself failed
              // (fileExists returns null then).
              if (sourceStillThere !== false) {
                pinnedSourcePath = fileMoved.old_key;
              }

              // Nothing found at either key. Pinning would record a path that
              // holds nothing and freeze the row: the guard above skips items
              // that already have a source_path, so no later move would retry
              // the relocation. Leave it null instead — still broken, but
              // still detectable and still retryable.
              const foundNothing =
                sourceStillThere === false && targetLanded !== true;

              this._logger.log(
                {
                  origin: 'LibraryService.processMovedFiles',
                  message: 'Storage relocation failed',
                  data: {
                    id_user: user.id_user,
                    oldKey: fileMoved.old_key,
                    newKey: fileMoved.key,
                    sourceStillThere,
                    targetLanded,
                    // The decision itself, not just its inputs. A remediation
                    // sweep can then separate a confirmed phantom (both
                    // probes 404) from one where the target probe only came
                    // back indeterminate.
                    foundNothing,
                    targetIndeterminate: targetLanded === null,
                    pinnedSourcePath: foundNothing ? null : pinnedSourcePath,
                  },
                },
                'error',
              );
              if (foundNothing) continue;
            }
            await this._libraryDB.updateBySourcePath(
              {
                user_id: user.id_user,
                key: fileMoved.key,
                source_path: pinnedSourcePath,
              },
              trx,
            );
          }
        }
      }),
    );
  }
}
