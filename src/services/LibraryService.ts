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
import { LibraryDB } from './db/LibraryDB';

export class LibraryService {
  private readonly _logger = logger;
  private db = database;

  constructor(
    private _storage: StorageService = new StorageService(),
    private _libraryDB: LibraryDB = new LibraryDB(),
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
          url: '',
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

  async getLibrary(
    user: User,
    path: string,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
    uuid?: string,
  ): Promise<LibraryItem[]> {
    try {
      const cleanPath = path.replace(`${user.email}/`, '');
      const objectDB = isValidUUID(uuid)
        ? await this._libraryDB.getLibraryByUuid(user.id_user, uuid)
        : await this._libraryDB.getLibrary(user.id_user, cleanPath);
      const library: LibraryItem[] = [];
      if (objectDB?.length) {
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
              if (options.withPresign) {
                const originalFile = itemDb.source_path || itemDb.key;
                const { url } = await this._storage.getPresignedUrl({
                  key: `${user.email}/${originalFile}`,
                  type: StorageAction.GET,
                });
                fileUrl = url;

                if (itemDb.thumbnail) {
                  const { url } = await this._storage.getPresignedUrl({
                    key: `${user.email}_thumbnail/${itemDb.thumbnail}`,
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
          };
          library.push(libObj);
        }
      }
      return library;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.getLibrary',
        message: err.message,
        data: { user, path },
      });
      return null;
    }
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
          const originalFile = itemDb.source_path || itemDb.key;
          const { url, expires_in } = await this._storage.getPresignedUrl({
            key: `${user.email}/${originalFile}`,
            type: StorageAction.GET,
          });
          fileUrl = url;
          libObj.expires_in = expires_in;
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
      libObj.source_path = `${process.env.ROOT_FOLDER}/${moment().format(
        'YYYYMMDDHHmmss',
      )}_${libObj.original_filename}`;
      if (itemDb) {
        const fileExists = await this._storage.fileExists({
          key: `${user.email}/${itemDb.source_path || itemDb.key}`,
        });
        if (fileExists === true) {
          return null;
        }
        // Override the source path with the stored path
        if (itemDb.source_path) {
          libObj.source_path = itemDb.source_path;
        }
      } else {
        itemDb = await this._libraryDB.insertLibraryItem(user.id_user, libObj);
      }
      const resourcePath = `${user.email}/${libObj.source_path}`;

      const { url, expires_in } = await this._storage.getPresignedUrl({
        key: resourcePath,
        type: StorageAction.PUT,
      });
      const apiResponse = (await this.parseLibraryItemDb(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      apiResponse.url = url;
      apiResponse.expires_in = expires_in;
      return apiResponse;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.putObject',
        message: err.stack || err.message,
        data: { user, params },
      });
      throw Error(err);
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

      for (let index = 0; index < deletedObjects.length; index++) {
        const item = deletedObjects[index];
        const keyPath =
          parseInt(item.type) === parseInt(LibraryItemType.BOOK)
            ? `${item.key}`
            : `${item.key}/`;
        const sourceKey = `${user.email}/${item.source_path || keyPath}`;
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

      const libraryItem = (await this.parseLibraryItemDb(
        { relativePath, ...params },
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

  async reOrderObject(user: User, params: LibraryItem): Promise<boolean> {
    let trx: Knex.Transaction;
    try {
      const { relativePath, orderRank } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this._libraryDB.getLibrary(user.id_user, cleanPath);

      if (objectDB.length !== 1) {
        throw Error('Item not found');
      }
      const prevOrder = objectDB[0].order_rank || 0;

      if (prevOrder === orderRank) {
        throw Error('The order is the same');
      }
      const isGreater = prevOrder < orderRank;
      const orderFilter: [number, number] = isGreater
        ? [prevOrder + 1, orderRank]
        : [orderRank, prevOrder - 1];

      const pathArray = relativePath.split('/');
      pathArray.pop();
      const path = pathArray.join('/');
      trx = await this.db.transaction();
      await this._libraryDB.shiftOrderRanks(
        {
          user_id: user.id_user,
          path,
          pathDepth: pathArray.length || 1,
          orderRange: orderFilter,
          direction: isGreater ? 'decrement' : 'increment',
        },
        trx,
      );

      await this._libraryDB.updateLibraryItem(
        user.id_user,
        cleanPath,
        { ...objectDB[0], order_rank: orderRank },
        null,
        trx,
      );
      await trx.commit();

      return true;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'LibraryService.reOrderObject',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
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
        let destinationDB = await this._libraryDB.getLibrary(
          user.id_user,
          destinationPathFolder,
          { exactly: true },
          trx,
        );

        if (destinationDB.length !== 1) {
          const name = destinationPathFolder.split('/').pop();
          await this._libraryDB.insertLibraryItem(
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

          destinationDB = await this._libraryDB.getLibrary(
            user.id_user,
            destinationPathFolder,
            { exactly: true },
            trx,
          );
        }
        const destType = `${destinationDB[0].type}`;
        if (
          destType !== LibraryItemType.FOLDER &&
          destType !== LibraryItemType.BOUND
        ) {
          throw Error('The destination is invalid');
        }
      }
      const originObj = await this._libraryDB.getLibrary(
        user.id_user,
        origin,
        { exactly: true },
        trx,
      );
      if (originObj.length !== 1) {
        // Check if item already exists at destination (already moved)
        const originFilename = origin.split('/').pop();
        const expectedDestinationPath =
          destinationPathFolder === ''
            ? originFilename
            : `${destinationPathFolder}/${originFilename}`;

        const destinationObj = await this._libraryDB.getLibrary(
          user.id_user,
          expectedDestinationPath,
          { exactly: true },
          trx,
        );

        if (destinationObj.length === 1) {
          // Item already moved to destination, return empty array
          await trx.commit();
          return [];
        }

        // Item doesn't exist at origin or destination
        throw Error(
          `Item not found at origin "${origin}" or destination "${expectedDestinationPath}"`,
        );
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
      throw Error(err);
    }
  }

  async moveLibraryObjectByUuid(
    user: User,
    params: { origin: string; destination: string },
  ): Promise<LibraryItemMovedDB[]> {
    const trx = await this.db.transaction();
    try {
      const [originDB] = await this._libraryDB.getLibraryByUuid(
        user.id_user,
        params.origin,
        null,
        trx,
      );
      const [destinationDB] = params.destination
        ? await this._libraryDB.getLibraryByUuid(
            user.id_user,
            params.destination,
            null,
            trx,
          )
        : [null];

      if (!originDB) {
        throw Error(`Item not found: "${params.origin}"`);
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
      throw Error(err);
    }
  }

  async deleteFolderMoving(user: User, folderPath: string): Promise<boolean> {
    const trx = await this.db.transaction();
    // Sanitize path to handle whitespace issues in folder names
    const sanitizedFolderPath = sanitizeLibraryPath(folderPath);
    try {
      const folderDB = await this._libraryDB.getLibrary(
        user.id_user,
        sanitizedFolderPath,
        { exactly: true },
        trx,
      );
      if (!folderDB[0]) {
        // Folder no longer exists
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
      const allFilesInside = await this._libraryDB.getNestedObjects(
        user.id_user,
        sanitizedFolderPath,
      );
      const dbMoved = await this._libraryDB.moveFilesUp(
        user.id_user,
        sanitizedFolderPath,
        trx,
      );
      const groupCounts = parseInt(`${dbMoved.length / 10}`);
      const groups =
        groupCounts > 1 ? splitArrayGroups(dbMoved, groupCounts) : [dbMoved];
      await Promise.all(
        groups.map(async (group: LibraryItemMovedDB[]) => {
          for (let indexTrx = 0; indexTrx < group.length; indexTrx++) {
            const fileMoved = group[indexTrx];
            const prevFile = allFilesInside.find(
              (preFile) =>
                preFile.id_library_item === fileMoved.id_library_item,
            );

            if (
              prevFile &&
              !fileMoved.source_path &&
              parseInt(fileMoved.type) === parseInt(LibraryItemType.BOOK)
            ) {
              const suffix =
                parseInt(prevFile.type) === parseInt(LibraryItemType.BOOK)
                  ? ''
                  : '/';
              const sourceKey = `${user.email}/${prevFile.key}${suffix}`;
              const original_filename = `${
                process.env.ROOT_FOLDER
              }/${moment().format('YYYYMMDDHHmmss')}_${
                fileMoved.original_filename
              }`;
              const targetKey = `${user.email}/${original_filename}`;
              const isMoved = await this._storage.moveFile({
                sourceKey,
                targetKey,
              });
              if (isMoved) {
                await this._libraryDB.updateBySourcePath(
                  {
                    user_id: user.id_user,
                    key: fileMoved.key,
                    source_path: original_filename,
                  },
                  trx,
                );
              }
            }
          }
        }),
      );

      const keyPath = `${folderDB[0].key}/`;
      const folderKey = `${user.email}/${folderDB[0].source_path || keyPath}`;
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
      throw Error(err.message);
    }
  }

  async getLastItemPlayed(
    user: User,
    options: { withPresign?: boolean; appVersion: string },
    trx?: Knex.Transaction,
  ): Promise<LibraryItem> {
    try {
      const itemDb = await this._libraryDB.getLastItemPlayed(user.id_user, trx);

      const item = (await this.parseLibraryItemDb(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
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
            : null;
          break;
        default: // deprecated old part
          if (options.withPresign) {
            const originalFile = item.source_path || itemDb.key;
            const { url, expires_in } = await this._storage.getPresignedUrl({
              key: `${user.email}/${originalFile}`,
              type: StorageAction.GET,
            });
            item.url = url;
            item.expires_in = expires_in;
          }
          break;
      }
      return item;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.getLastItemPlayed',
        message: err.message,
        data: { user },
      });
      return null;
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
  ): Promise<string | boolean> {
    try {
      const { relativePath, uuid, thumbnail_name, uploaded } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = isValidUUID(uuid)
        ? await this._libraryDB.getLibraryByUuid(user.id_user, uuid, {
          exactly: true,
        })
        : await this._libraryDB.getLibrary(user.id_user, cleanPath, {
          exactly: true,
        });
      const itemDb = objectDB?.[0];
      if (!itemDb) {
        throw new Error('Item not exists');
      }
      if (uploaded) {
        const idUpdated = await this._libraryDB.updateThumbnail({
          id_library_item: itemDb.id_library_item,
          thumbnail: thumbnail_name,
        });
        return !!idUpdated;
      }
      const { url } = await this._storage.getPresignedUrl({
        key: `${user.email}_thumbnail/${thumbnail_name}`,
        type: StorageAction.PUT,
      });
      return url;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryService.thumbnailPutRequest',
        message: err.message,
        data: { user, params },
      });
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
          movedChildren = await this._libraryDB.renameFiles(
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
            const suffix =
              parseInt(fileMoved.type) === parseInt(LibraryItemType.BOOK)
                ? ''
                : '/';
            const sourceKey = `${user.email}/${fileMoved.old_key}${suffix}`;
            const original_filename = `${
              process.env.ROOT_FOLDER
            }/${moment().format('YYYYMMDDHHmmss')}_${
              fileMoved.original_filename
            }`;
            const targetKey = `${user.email}/${original_filename}`;
            const isMoved = await this._storage.moveFile({
              sourceKey,
              targetKey,
            });
            if (isMoved) {
              await this._libraryDB.updateBySourcePath(
                {
                  user_id: user.id_user,
                  key: fileMoved.key,
                  source_path: original_filename,
                },
                trx,
              );
            }
          }
        }
      }),
    );
  }
}
