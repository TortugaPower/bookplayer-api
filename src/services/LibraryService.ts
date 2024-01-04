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
    user_id: number,
    path: string,
    trx?: Knex.Transaction,
    exactly?: boolean,
  ): Promise<LibrarItemDB[]> {
    try {
      const db = trx || this.db;
      const objectsDeleted = await db('library_items as li')
        .update({
          active: false,
        })
        .where({
          user_id,
          active: true,
        })
        .whereRaw('key like ?', [`${path}${exactly ? '' : '%'}`])
        .returning('*');
      return objectsDeleted;
    } catch (err) {
      this._logger.log({
        origin: 'dbDeleteLibrary',
        message: err.message,
        data: { user_id, path, exactly },
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
      returning ss.id_library_item, ss.key, ss.type, filtro.old_key;
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
      returning ss.id_library_item, ss.key, ss.type, filtro.old_key;
      `,
          [destination, origin, user_id, `${origin}%`],
        )
        .debug(true)
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
      returning ss.id_library_item, ss.key, ss.type;
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
          title: item.title,
          original_filename: item.original_filename,
          speed: item.speed,
          actual_time: item.actual_time,
          details: item.details,
          duration: item.duration,
          percent_completed: item.percent_completed,
          order_rank: item.order_rank,
          last_play_date: !!item.last_play_date
            ? parseInt(`${item.last_play_date}`)
            : null,
          type: item.type,
          is_finish: item.is_finish,
          thumbnail: item.thumbnail || null,
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
  ): Promise<LibrarItemDB> {
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
      const objects = await db('library_items')
        .update(updateObject)
        .where({
          user_id,
          key: key,
        })
        .returning('*');
      return objects[0];
    } catch (err) {
      this._logger.log({
        origin: 'dbUpdateLibraryItem',
        message: err.message,
        data: { user_id, key, item },
      });
      return null;
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
                const { url } = await this._storage.GetPresignedUrl({
                  key: `${user.email}/${itemDb.key}`,
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
            currentTime: parseFloat(itemDb.actual_time),
            duration: parseFloat(itemDb.duration),
            percentCompleted: itemDb.percent_completed,
            isFinished: itemDb.is_finish,
            orderRank: itemDb.order_rank,
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
          currentTime: parseFloat(itemTemp.actual_time),
          duration: parseFloat(itemTemp.duration),
          percentCompleted: itemTemp.percent_completed,
          isFinished: itemTemp.is_finish,
          orderRank: itemTemp.order_rank,
          lastPlayDateTimestamp: itemTemp.last_play_date,
          type: itemTemp.type,
          thumbnail: itemTemp.thumbnail,
          url: '',
          synced: itemTemp.synced,
        };
        break;
      case LibraryItemOutput.DB:
        const itemApi = item as LibraryItem;
        parsed = {
          key: itemApi.relativePath,
          title: itemApi.title,
          original_filename: itemApi.originalFileName,
          speed: itemApi.speed,
          details: itemApi.details,
          actual_time: itemApi.currentTime
            ? `${itemApi.currentTime}`
            : undefined,
          duration: !!itemApi.duration ? `${itemApi.duration}` : undefined,
          percent_completed: itemApi.percentCompleted,
          order_rank: itemApi.orderRank,
          last_play_date:
            !!itemApi.lastPlayDateTimestamp &&
            `${itemApi.lastPlayDateTimestamp}`.trim() !== ''
              ? parseInt(`${itemApi.lastPlayDateTimestamp}`)
              : null,
          type: itemApi.type,
          is_finish: itemApi.isFinished,
          thumbnail: itemApi.thumbnail,
          synced: itemApi.synced !== undefined ? itemApi.synced : undefined,
        };
        break;
    }
    return parsed;
  }

  async GetObject(user: User, path: string): Promise<LibraryItem> {
    try {
      const cleanPath = path.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);
      const itemDb = objectDB[0];
      if (!itemDb) {
        throw Error('Item not found');
      }
      const { url, expires_in } = await this._storage.GetPresignedUrl({
        key: `${user.email}/${itemDb.key}`,
        type: StorageAction.GET,
      });
      const libObj = (await this.ParseLibraryItemDbB(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      libObj.url = url;
      libObj.expires_in = expires_in;
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
      if (itemDb) {
        const fileExists = await this._storage.fileExists({
          key: `${user.email}/${relativePath}`,
        });
        if (fileExists === true) {
          return null;
        }
      } else {
        itemDb = await this.dbInsertLibraryItem(user.id_user, libObj);
      }

      // S3 needs the forward slash to create an empty folder
      const resourcePath =
        parseInt(libObj.type) === parseInt(LibraryItemType.BOOK)
          ? `${user.email}/${relativePath}`
          : `${user.email}/${relativePath}/`;

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
      const deletedObjects = await this.dbDeleteLibrary(
        user.id_user,
        cleanPath,
      );
      const itemDb = deletedObjects[0];
      if (!itemDb) {
        throw Error('Item does not exist');
      }

      for (let index = 0; index < deletedObjects.length; index++) {
        const item = deletedObjects[index];
        const sourceKey = `${user.email}/${item.key}`;
        await this._storage.deleteFile({
          sourceKey: `${sourceKey}${
            parseInt(item.type) === parseInt(LibraryItemType.BOOK) ? '' : '/'
          }`,
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
  ): Promise<LibraryItem> {
    try {
      const cleanPath = relativePath.replace(`${user.email}/`, '');

      const libraryItem = (await this.ParseLibraryItemDbB(
        {
          relativePath,
          ...params,
        },
        LibraryItemOutput.DB,
      )) as LibrarItemDB;
      const itemDbInserted = await this.dbUpdateLibraryItem(
        user.id_user,
        cleanPath,
        libraryItem,
      );

      const item = (await this.ParseLibraryItemDbB(
        itemDbInserted,
        LibraryItemOutput.API,
      )) as LibraryItem;
      return item;
    } catch (err) {
      this._logger.log({
        origin: 'UpdateObject',
        message: err.message,
        data: { user, relativePath, params },
      });
      throw Error(err);
    }
  }

  async reOrderObject(user: User, params: LibraryItem): Promise<LibraryItem> {
    let trx;
    try {
      const { relativePath, orderRank } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);

      if (objectDB.length !== 1) {
        throw Error('Item not found');
      }
      const prevOrder = objectDB[0].order_rank;

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

      const itemDbInserted = await this.dbUpdateLibraryItem(
        user.id_user,
        cleanPath,
        {
          ...objectDB[0],
          order_rank: orderRank,
        },
        trx,
      );
      await trx.commit();

      const item = (await this.ParseLibraryItemDbB(
        itemDbInserted,
        LibraryItemOutput.API,
      )) as LibraryItem;

      return item;
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
      const { origin, destination } = params;
      const destinationPathFolder = destination.trim();

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
              actual_time: null,
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
        const destinationObj = await this.dbGetLibrary(
          user.id_user,
          destination,
          { exactly: true },
          trx,
        );
        if (destinationObj.length !== 1) {
          throw Error('origin is invalid');
        } else {
          await trx.commit();
          return [];
        }
      }

      const dbMoved = await this.dbMoveFiles(
        user.id_user,
        origin,
        destinationPathFolder,
        trx,
      );

      for (let index = 0; index < dbMoved.length; index++) {
        const fileMoved = dbMoved[index];
        const suffix =
          parseInt(fileMoved.type) === parseInt(LibraryItemType.BOOK)
            ? ''
            : '/';
        const sourceKey = `${user.email}/${fileMoved.old_key}${suffix}`;
        const targetKey = `${user.email}/${fileMoved.key}${suffix}`;
        await this._storage.moveFile({
          sourceKey,
          targetKey,
        });
      }

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
    try {
      const folderDB = await this.dbGetLibrary(
        user.id_user,
        folderPath,
        { exactly: true },
        trx,
      );
      if (!folderDB[0]) {
        // Folder no longer exists
        return true;
      }
      const folderDeleted = await this.dbDeleteLibrary(
        user.id_user,
        folderPath,
        trx,
        true,
      );
      if (!folderDeleted) {
        throw Error('folder not deleted');
      }
      const allFilesInside = await this.dbNestedObjects(
        user.id_user,
        folderPath,
      );
      const dbMoved = await this.dbMoveFilesUp(user.id_user, folderPath, trx);
      for (let index = 0; index < dbMoved.length; index++) {
        const fileMoved = dbMoved[index];
        const prevFile = allFilesInside.find(
          (preFile) => preFile.id_library_item === fileMoved.id_library_item,
        );

        if (prevFile) {
          const suffix =
            parseInt(prevFile.type) === parseInt(LibraryItemType.BOOK)
              ? ''
              : '/';
          const sourceKey = `${user.email}/${prevFile.key}${suffix}`;
          const targetKey = `${user.email}/${fileMoved.key}${suffix}`;
          await this._storage.moveFile({
            sourceKey,
            targetKey,
          });
        }
      }

      await this._storage.deleteFile({
        sourceKey: `${user.email}/${folderDB[0].key}/`,
      });

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
            const { url, expires_in } = await this._storage.GetPresignedUrl({
              key: `${user.email}/${itemDb.key}`,
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
      /// Verify destination folder doesnt exists
      if (!!destinationDB.length) {
        throw new Error('There is a folder with the same name');
      }

      const dbMoved = await this.dbRenameFiles(
        user.id_user,
        item.key,
        destinationPathFolder,
        trx,
      );
      for (let index = 0; index < dbMoved.length; index++) {
        const fileMoved = dbMoved[index];
        const suffix =
          parseInt(fileMoved.type) === parseInt(LibraryItemType.BOOK)
            ? ''
            : '/';
        const sourceKey = `${user.email}/${fileMoved.old_key}${suffix}`;
        const targetKey = `${user.email}/${fileMoved.key}${suffix}`;
        await this._storage.moveFile({
          sourceKey,
          targetKey,
        });
      }

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
