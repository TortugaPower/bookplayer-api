import { inject, injectable } from 'inversify';
import {
  Bookmark,
  LibrarItemDB,
  LibraryItemMovedDB,
  LibraryItem,
  LibraryItemOutput,
  LibraryItemType,
  StorageAction,
  User,
} from '../types/user';
import { Knex } from 'knex';
import database from '../database';
import { TYPES } from '../ContainerTypes';
import { IStorageService } from '../interfaces/IStorageService';
import { ILoggerService } from '../interfaces/ILoggerService';
import moment from 'moment-timezone';
import {
  splitArrayGroups,
  detectExcessiveFolderNesting,
  sanitizeLibraryPath,
} from '../utils';

@injectable()
export class LibraryService {
  @inject(TYPES.StorageService)
  private _storage: IStorageService;
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  private db = database;

  async dbGetAllKeys(user_id: number): Promise<string[]> {
    try {
      const objects = await this.db('library_items as li')
        .where({
          user_id,
          active: true,
          synced: true,
        })
        .orderBy('key', 'asc')
        .debug(false);
      return objects.map((item) => item.key);
    } catch (err) {
      this._logger.log({
        origin: 'dbGetAlKeys',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  async dbGetLibrary(
    user_id: number,
    path: string,
    filter?: {
      rawFilter?: string;
      exactly?: boolean;
    },
    trx?: Knex.Transaction,
  ): Promise<LibrarItemDB[]> {
    try {
      const db = trx || this.db;
      const pathNumber = path.split('/').length;
      const objects = await db('library_items as li')
        .where({
          user_id,
          active: true,
        })
        .whereRaw("array_length(string_to_array(key, '/'), 1) = ?", [
          pathNumber,
        ])
        .whereRaw('key like ?', [`${path}${filter?.exactly ? '' : '%'}`])
        .andWhere((builder) => {
          if (!!filter?.rawFilter) {
            builder.whereRaw(filter?.rawFilter);
          } else {
            builder.where(true);
          }
        })
        .orderBy('order_rank', 'asc')
        .debug(false);
      return objects;
    } catch (err) {
      this._logger.log({
        origin: 'dbGetLibrary',
        message: err.message,
        data: { user_id, path, filter },
      });
      return null;
    }
  }

  async getItemByThumbnail(
    user_id: number,
    thumbnail: string,
    trx?: Knex.Transaction,
  ): Promise<LibrarItemDB> {
    try {
      const db = trx || this.db;
      const item = await db('library_items as li')
        .where({
          user_id,
          active: true,
          thumbnail,
        })
        .first();
      return item;
    } catch (err) {
      this._logger.log({
        origin: 'getItemByThumbnail',
        message: err.message,
        data: { user_id, thumbnail },
      });
      return null;
    }
  }

  async dbDeleteLibrary(
    params: {
      user_id: number;
      path: string;
      exactly?: boolean;
      active?: boolean;
    },
    trx?: Knex.Transaction,
  ): Promise<LibrarItemDB[]> {
    try {
      const { user_id, path, exactly, active } = params;
      const db = trx || this.db;
      const objectsDeleted = await db('library_items as li')
        .update({
          active: false,
        })
        .where({
          user_id,
          active: active === false ? active : true,
        })
        .whereRaw('key like ?', [`${path}${exactly ? '' : '%'}`])
        .returning('*');
      return objectsDeleted;
    } catch (err) {
      this._logger.log({
        origin: 'dbDeleteLibrary',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async dbNestedObjects(
    user_id: number,
    folderPath: string,
    trx?: Knex.Transaction,
  ): Promise<LibrarItemDB[]> {
    try {
      const db = trx || this.db;
      const nestedObjects = await db
        .raw(
          `
          select id_library_item, key, type
          from library_items
          where user_id=? and active=true and key like ?
      `,
          [user_id, `${folderPath}/%`],
        )
        .then((result) => result.rows);
      return nestedObjects;
    } catch (err) {
      this._logger.log({
        origin: 'dbNestedObjects',
        message: err.message,
        data: { user_id, folderPath },
      });
      return null;
    }
  }

  async dbMoveFiles(
    user_id: number,
    origin: string,
    destination: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemMovedDB[]> {
    try {
      const destinationPath = destination !== '' ? `${destination}/` : '';
      const db = trx || this.db;
      const objectsMoved = await db
        .raw(
          `
      update library_items ss
      set key=filtro.newKey
      from (select filtroKey.id_library_item,
              concat(cast(? as text), array_to_string(removing[removeIndex:array_length(removing, 1)], '/')) as newKey,
              filtroKey.old_key as old_key
            from (
                select id_library_item,
                        string_to_array(key, '/') as removing,
                        array_length(string_to_array(?, '/'), 1) as removeIndex,
                        key as old_key
                from library_items
                where user_id=? and active=true and key like ?
            ) as filtroKey) as filtro
      where ss.id_library_item = filtro.id_library_item
      returning ss.id_library_item, ss.key, ss.type, filtro.old_key, ss.original_filename, ss.source_path;
      `,
          [destinationPath, origin, user_id, `${origin}%`],
        )
        .then((result) => result.rows);
      return objectsMoved;
    } catch (err) {
      this._logger.log({
        origin: 'dbMoveFiles',
        message: err.message,
        data: { origin, destination },
      });
      return null;
    }
  }

  async dbRenameFiles(
    user_id: number,
    origin: string,
    destination: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemMovedDB[]> {
    try {
      const db = trx || this.db;
      const objectsMoved = await db
        .raw(
          `
      update library_items ss
      set key=filtro.newKey
      from (select filtroKey.id_library_item,
              concat(
                cast(? as text),
                case when array_to_string(removing[removeIndex::int + 1:array_length(removing, 1)], '') != '' then '/' else '' end,
                array_to_string(removing[removeIndex::int + 1:array_length(removing, 1)], '/')
              ) as newKey,
              filtroKey.old_key as old_key
            from (
                select id_library_item,
                        string_to_array(key, '/') as removing,
                        array_length(string_to_array(?, '/'), 1) as removeIndex,
                        key as old_key
                from library_items
                where user_id=? and active=true and key like ?
            ) as filtroKey) as filtro
      where ss.id_library_item = filtro.id_library_item
      returning ss.id_library_item, ss.key, ss.type, filtro.old_key, ss.source_path, ss.original_filename;
      `,
          [destination, origin, user_id, `${origin}%`],
        )
        .debug(false)
        .then((result) => result.rows);
      return objectsMoved;
    } catch (err) {
      this._logger.log({
        origin: 'dbRenameFiles',
        message: err.message,
        data: { user_id, origin, destination },
      });
      return null;
    }
  }

  async processMovedFiles(
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
              await trx('library_items')
                .update({
                  source_path: original_filename,
                })
                .where({
                  user_id: user.id_user,
                  key: fileMoved.key,
                });
            }
          }
        }
      }),
    );
  }

  /// TODO: replace this function in favor of `dbMoveFiles`
  async dbMoveFilesUp(
    user_id: number,
    folderPath: string,
    trx?: Knex.Transaction,
  ): Promise<LibrarItemDB[]> {
    try {
      const db = trx || this.db;
      const objectsMoved = await db
        .raw(
          `
      update library_items ss
      set key=filtro.newKey
      from (select filtroKey.id_library_item,
                  array_to_string(removing[1:removeIndex-1] || removing[removeIndex+1:], '/') as newKey
            from (
                    select id_library_item,
                            string_to_array(key, '/') as removing,
                            array_length(string_to_array(?, '/'), 1) as removeIndex
                    from library_items
                    where user_id=? and active=true and key like ?
                ) as filtroKey) as filtro
      where ss.id_library_item = filtro.id_library_item
      returning ss.id_library_item, ss.key, ss.type, ss.original_filename, ss.source_path;
      `,
          [folderPath, user_id, `${folderPath}/%`],
        )
        .then((result) => result.rows);
      return objectsMoved;
    } catch (err) {
      this._logger.log({
        origin: 'dbMoveFilesUp',
        message: err.message,
        data: { user_id, folderPath },
      });
      return null;
    }
  }

  async dbInsertLibraryItem(
    user_id: number,
    item: LibrarItemDB,
    trx?: Knex.Transaction,
  ): Promise<LibrarItemDB> {
    try {
      const db = trx || this.db;
      const objects = await db('library_items as li')
        .insert({
          user_id,
          key: item.key,
          title: item.title.substring(0, 255),
          original_filename: item.original_filename,
          speed: item.speed,
          actual_time: item.actual_time || '0',
          details: item.details.substring(0, 255),
          duration: item.duration,
          percent_completed: item.percent_completed,
          order_rank: item.order_rank || 0,
          last_play_date: !!item.last_play_date
            ? parseInt(`${item.last_play_date}`)
            : null,
          type: item.type,
          is_finish: item.is_finish,
          thumbnail: item.thumbnail || null,
          source_path: item.source_path,
        })
        .returning('*');
      return objects[0];
    } catch (err) {
      this._logger.log({
        origin: 'dbInsertLibraryItem',
        message: err.message,
        data: { user_id, item },
      });
      return null;
    }
  }

  async dbUpdateLibraryItem(
    user_id: number,
    key: string,
    item: LibrarItemDB,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    try {
      const db = trx || this.db;
      const updateObject = Object.keys(item).reduce(
        (cleanItem: { [k: string]: unknown }, column: string) => {
          const itemUnknow = item as unknown as { [k: string]: unknown };
          if (itemUnknow[column] !== undefined) {
            cleanItem[column] = itemUnknow[column];
          }
          return cleanItem;
        },
        {},
      );
      await db('library_items').update(updateObject).where({
        user_id,
        key: key,
      });
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'dbUpdateLibraryItem',
        message: err.message,
        data: { user_id, key, item },
      });
      return false;
    }
  }

  async GetLibrary(
    user: User,
    path: string,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
  ): Promise<LibraryItem[]> {
    try {
      const cleanPath = path.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);
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
                const { url } = await this._storage.GetPresignedUrl({
                  key: `${user.email}/${originalFile}`,
                  type: StorageAction.GET,
                });
                fileUrl = url;

                if (itemDb.thumbnail) {
                  const { url } = await this._storage.GetPresignedUrl({
                    key: `${user.email}_thumbnail/${itemDb.thumbnail}`,
                    type: StorageAction.GET,
                  });
                  thumbnail = url;
                }
              }
              break;
          }

          const libObj: LibraryItem = {
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
        origin: 'GetLibrary',
        message: err.message,
        data: { user, path },
      });
      return null;
    }
  }

  async ParseLibraryItemDbB(
    item: LibrarItemDB | LibraryItem,
    output: LibraryItemOutput,
  ): Promise<LibrarItemDB | LibraryItem> {
    let parsed: LibraryItem | LibrarItemDB;
    switch (output) {
      case LibraryItemOutput.API:
        const itemTemp = item as LibrarItemDB;
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
        };
        break;
    }
    return parsed;
  }

  async GetObject(
    user: User,
    path: string,
    appVersion?: string,
  ): Promise<LibraryItem> {
    try {
      const cleanPath = path.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);
      const itemDb = objectDB[0];
      if (!itemDb) {
        throw Error('Item not found');
      }
      const libObj = (await this.ParseLibraryItemDbB(
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
          const { url, expires_in } = await this._storage.GetPresignedUrl({
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
        origin: 'GetObject',
        message: err.message,
        data: { user, path },
      });
      return null;
    }
  }

  async PutObject(user: User, params: LibraryItem): Promise<LibraryItem> {
    try {
      const { relativePath } = params;

      // Detect excessive folder nesting with same name
      const nestingCheck = detectExcessiveFolderNesting(relativePath, 5);
      if (nestingCheck.isExcessive) {
        // Log the anomaly and return success without processing
        this._logger.log({
          origin: 'PutObject',
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
      const libObj = (await this.ParseLibraryItemDbB(
        params,
        LibraryItemOutput.DB,
      )) as LibrarItemDB;

      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath, {
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
        itemDb = await this.dbInsertLibraryItem(user.id_user, libObj);
      }
      const resourcePath = `${user.email}/${libObj.source_path}`;

      const { url, expires_in } = await this._storage.GetPresignedUrl({
        key: resourcePath,
        type: StorageAction.PUT,
      });
      const apiResponse = (await this.ParseLibraryItemDbB(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      apiResponse.url = url;
      apiResponse.expires_in = expires_in;
      return apiResponse;
    } catch (err) {
      this._logger.log({
        origin: 'PutObject',
        message: err.stack || err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }

  async DeleteObject(user: User, params: LibraryItem): Promise<string[]> {
    try {
      const { relativePath } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const deletedObjects = await this.dbDeleteLibrary({
        user_id: user.id_user,
        path: cleanPath,
      });
      const itemDb = deletedObjects[0];
      if (!itemDb) {
        const alreadyDeleted = await this.dbDeleteLibrary({
          user_id: user.id_user,
          path: cleanPath,
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
        await this._storage.deleteFile({
          sourceKey,
        });
      }
      return deletedObjects.map((i) => i.key);
    } catch (err) {
      this._logger.log({
        origin: 'DeleteObject',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }

  async UpdateObject(
    user: User,
    relativePath: string,
    params: LibraryItem,
  ): Promise<boolean> {
    try {
      const cleanPath = relativePath.replace(`${user.email}/`, '');

      const libraryItem = (await this.ParseLibraryItemDbB(
        {
          relativePath,
          ...params,
        },
        LibraryItemOutput.DB,
      )) as LibrarItemDB;
      const result = await this.dbUpdateLibraryItem(
        user.id_user,
        cleanPath,
        libraryItem,
      );

      return result;
    } catch (err) {
      this._logger.log({
        origin: 'UpdateObject',
        message: err.message,
        data: { user, relativePath, params },
      });
      throw Error(err);
    }
  }

  async reOrderObject(user: User, params: LibraryItem): Promise<boolean> {
    let trx;
    try {
      const { relativePath, orderRank } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);

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
      await trx('library_items as li')
        .update({
          order_rank: trx.raw(`order_rank ${isGreater ? '-' : '+'} 1`),
        })
        .where({
          user_id: user.id_user,
          active: true,
        })
        .whereRaw("array_length(string_to_array(key, '/'), 1) = ?", [
          pathArray.length || 1,
        ])
        .whereRaw('key like ?', [`${path}%`])
        .whereBetween('order_rank', orderFilter)
        .debug(false);

      await this.dbUpdateLibraryItem(
        user.id_user,
        cleanPath,
        {
          ...objectDB[0],
          order_rank: orderRank,
        },
        trx,
      );
      await trx.commit();

      return true;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'reOrderObject',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }

  async moveLibraryObject(
    user: User,
    params: {
      origin: string;
      destination: string;
    },
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
        let destinationDB = await this.dbGetLibrary(
          user.id_user,
          destinationPathFolder,
          { exactly: true },
          trx,
        );

        if (destinationDB.length !== 1) {
          const name = destinationPathFolder.split('/').pop();
          await this.dbInsertLibraryItem(
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

          destinationDB = await this.dbGetLibrary(
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
      const originObj = await this.dbGetLibrary(
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

        const destinationObj = await this.dbGetLibrary(
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
      const dbMoved = await this.dbMoveFiles(
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
        origin: 'moveLibraryObject',
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
      const folderDB = await this.dbGetLibrary(
        user.id_user,
        sanitizedFolderPath,
        { exactly: true },
        trx,
      );
      if (!folderDB[0]) {
        // Folder no longer exists
        return true;
      }
      const folderDeleted = await this.dbDeleteLibrary(
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
      const allFilesInside = await this.dbNestedObjects(
        user.id_user,
        sanitizedFolderPath,
      );
      const dbMoved = await this.dbMoveFilesUp(user.id_user, sanitizedFolderPath, trx);
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
                console.log('is moved', isMoved, original_filename, fileMoved);
                await trx('library_items')
                  .update({
                    source_path: original_filename,
                  })
                  .where({
                    user_id: user.id_user,
                    key: fileMoved.key,
                  });
              }
            }
          }
        }),
      );

      const keyPath = `${folderDB[0].key}/`;
      const folderKey = `${user.email}/${folderDB[0].source_path || keyPath}`;
      const folderExist = await this._storage.fileExists({
        key: folderKey,
      });
      if (folderExist) {
        await this._storage.deleteFile({
          sourceKey: folderKey,
        });
      }

      await trx.commit();
      return true;
    } catch (err) {
      await trx?.rollback();
      this._logger.log({
        origin: 'deleteFolderMoving',
        message: err.message,
        data: { user, folderPath },
      });
      throw Error(err.message);
    }
  }

  async dbGetLastItemPlayed(
    user: User,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
    trx?: Knex.Transaction,
  ): Promise<LibraryItem> {
    try {
      const db = trx || this.db;
      const itemDb = await db('library_items as li')
        .where({
          user_id: user.id_user,
          active: true,
        })
        .andWhereNot('type', 0)
        .andWhereRaw('last_play_date is not null')
        .orderBy('last_play_date', 'desc')
        .first()
        .debug(false);

      const item = (await this.ParseLibraryItemDbB(
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
            const { url, expires_in } = await this._storage.GetPresignedUrl({
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
        origin: 'dbGetLastItemPlayed',
        message: err.message,
        data: { user },
      });
      return null;
    }
  }

  async getBookmarks(
    params: {
      key?: string;
      user_id: number;
    },
    trx?: Knex.Transaction,
  ): Promise<Bookmark[]> {
    try {
      const { key, user_id } = params;
      const db = trx || this.db;
      const filter: (number | string)[] = [user_id];
      let whereFilter = '';
      if (key) {
        filter.push(key);
        whereFilter += ' and li.key=? ';
      }
      const bookmarks = await db
        .raw(
          `
        select li.title, li.key, b.note, b.time, b.active from library_items li
        join bookmarks b on li.id_library_item = b.library_item_id and b.active=true
        where li.user_id=? and li.active=true ${whereFilter}
      `,
          filter,
        )
        .then((result) => result.rows);

      return bookmarks;
    } catch (err) {
      this._logger.log({
        origin: 'getBookmarks',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async upsertBookmark(
    bookmark: Bookmark,
    trx?: Knex.Transaction,
  ): Promise<Bookmark> {
    try {
      const db = trx || this.db;
      const selectColumns = ['note', 'time', 'active'];
      const updated = await db('bookmarks')
        .insert({
          note: bookmark.note,
          time: bookmark.time,
          library_item_id: bookmark.library_item_id,
        })
        .onConflict(['library_item_id', 'time'])
        .merge({
          note: bookmark.note,
          active: bookmark.active,
        })
        .returning(selectColumns);
      return updated[0];
    } catch (err) {
      this._logger.log({
        origin: 'upsertBookmark',
        message: err.message,
        data: { bookmark },
      });
      return null;
    }
  }

  async thumbailPutRequest(
    user: User,
    params: {
      relativePath: string;
      thumbnail_name: string;
      uploaded?: boolean;
    },
  ): Promise<string | boolean> {
    try {
      const { relativePath, thumbnail_name, uploaded } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath, {
        exactly: true,
      });
      const itemDb = objectDB[0];
      if (!itemDb) {
        throw new Error('Item not exists');
      }
      if (uploaded) {
        const idUpdated = await this.db('library_items')
          .update({
            thumbnail: thumbnail_name,
          })
          .where({
            id_library_item: itemDb.id_library_item,
          })
          .returning('id_library_item');
        return !!idUpdated[0].id_library_item;
      }
      const { url } = await this._storage.GetPresignedUrl({
        key: `${user.email}_thumbnail/${thumbnail_name}`,
        type: StorageAction.PUT,
      });
      return url;
    } catch (err) {
      this._logger.log({
        origin: 'thumbailPutRequest',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }

  async renameLibraryObject(
    user: User,
    params: {
      item: LibrarItemDB;
      newName: string;
    },
  ): Promise<LibraryItemMovedDB[]> {
    const trx = await this.db.transaction();
    try {
      const { item, newName } = params;
      const itemDb = await trx('library_items')
        .update({
          title: newName,
        })
        .where({
          user_id: user.id_user,
          id_library_item: item.id_library_item,
        })
        .returning('*');
      if (parseInt(item.type) === parseInt(LibraryItemType.BOOK)) {
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
      const destinationDB = await this.dbGetLibrary(
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
          await trx('library_items')
            .update({
              duration: item.duration,
              details: item.details,
              actual_time: item.actual_time,
              percent_completed: item.percent_completed,
              last_play_date: item.last_play_date,
            })
            .where({
              id_library_item: destination.id_library_item,
            });
        }

        // Check for nested children and update their keys
        const nestedChildren = await this.dbNestedObjects(
          user.id_user,
          item.key,
          trx,
        );

        let movedChildren: LibraryItemMovedDB[] = [];

        if (nestedChildren.length > 0) {
          // Use dbRenameFiles to update all children keys from origin to destination
          movedChildren = await this.dbRenameFiles(
            user.id_user,
            item.key,
            destination.key,
            trx,
          );

          // Process moved children (handle storage operations)
          await this.processMovedFiles(user, movedChildren, trx);
        }

        // Always soft delete origin folder when destination exists
        await trx('library_items')
          .update({
            active: false,
          })
          .where({
            id_library_item: item.id_library_item,
          });

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

      const dbMoved = await this.dbRenameFiles(
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
        origin: 'renameLibraryObject',
        message: err.message,
        data: { user, params },
      });
      throw Error(err);
    }
  }
}
