import { inject, injectable } from 'inversify';
import {
  LibrarItemDB,
  LibraryItem,
  LibraryItemOutput,
  LibraryItemType,
  S3Action,
  User,
} from '../types/user';
import { Knex } from 'knex';
import database from '../database';
import { TYPES } from '../ContainerTypes';
import { IStorageService } from '../interfaces/IStorageService';

@injectable()
export class LibraryService {
  @inject(TYPES.StorageService)
  private _storage: IStorageService;
  private db = database;

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
        .debug(false);
      return objects;
    } catch (err) {
      console.log(err.message);
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
      console.log(err.message);
      return null;
    }
  }

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
                  array_to_string(array_remove(removing, removing[removeIndex]), '/') as newKey
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
      console.log(err.message);
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
        })
        .returning('*');
      return objects[0];
    } catch (err) {
      console.log(err.message);
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
      const objects = await db('library_items')
        .update(item)
        .where({
          user_id,
          key: key,
        })
        .returning('*');
      return objects[0];
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async GetLibrary(
    user: User,
    path: string,
    withPresign?: boolean,
  ): Promise<LibraryItem[]> {
    try {
      const storageObjects = await this._storage.GetDirectoryContent(path);
      const cleanPath = path.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);
      const library: LibraryItem[] = [];
      if (objectDB?.length) {
        for (let index = 0; index < objectDB.length; index++) {
          const itemDb = objectDB[index];
          const storageObj = storageObjects.find(
            (item) => item.Key.indexOf(itemDb.key) !== -1,
          );
          if (storageObj) {
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
              url: null,
            };
            if (withPresign) {
              libObj.url = await this._storage.GetPresignedUrl(
                `${user.email}/${itemDb.key}`,
                S3Action.GET,
              );
            }
            library.push(libObj);
          }
        }
      }
      return library;
    } catch (err) {
      console.log(err.message);
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
          url: '',
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
          actual_time: `${itemApi.currentTime}`,
          duration: `${itemApi.duration}`,
          percent_completed: itemApi.percentCompleted,
          order_rank: itemApi.orderRank,
          last_play_date: !!itemApi.lastPlayDateTimestamp
            ? parseInt(`${itemApi.lastPlayDateTimestamp}`)
            : null,
          type: itemApi.type,
          is_finish: itemApi.isFinished,
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
      const url = await this._storage.GetPresignedUrl(
        `${user.email}/${itemDb.key}`,
        S3Action.GET,
      );
      const libObj = (await this.ParseLibraryItemDbB(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      libObj.url = url;
      return libObj;
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async PutObject(user: User, params: LibraryItem): Promise<LibraryItem> {
    try {
      const { relativePath } = params;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);
      const itemDb = objectDB[0];
      if (itemDb) {
        throw Error('Item already exists');
      }
      const libObj = (await this.ParseLibraryItemDbB(
        params,
        LibraryItemOutput.DB,
      )) as LibrarItemDB;
      
      // S3 needs the forward slash to create an empty folder
      const resourcePath = libObj.type == LibraryItemType.BOOK
      ? `${user.email}/${relativePath}`
      : `${user.email}/${relativePath}/`;
      
      const url = await this._storage.GetPresignedUrl(
        resourcePath,
        S3Action.PUT,
      );
      const itemDbInserted = await this.dbInsertLibraryItem(
        user.id_user,
        libObj,
      );
      const apiResponse = (await this.ParseLibraryItemDbB(
        itemDbInserted,
        LibraryItemOutput.API,
      )) as LibraryItem;
      apiResponse.url = url;
      return apiResponse;
    } catch (err) {
      console.log(err.message);
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
        const targetKey = `${user.email}_deleted/${item.key}`;
        await this._storage.copyFile(
          `${sourceKey}${item.type === LibraryItemType.BOOK ? '' : '/'}`,
          targetKey,
          item.type === LibraryItemType.BOOK,
        );
      }
      return deletedObjects.map((i) => i.key);
    } catch (err) {
      console.log(err.message);
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
        params,
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
      console.log(err.message);
      throw Error(err);
    }
  }

  async reOrderObject(user: User, params: LibraryItem): Promise<LibraryItem> {
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
      const trx = await this.db.transaction();
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
      console.log(err.message);
      throw Error(err);
    }
  }

  async moveLibraryObject(
    user: User,
    params: {
      origin: string;
      destination: string;
    },
  ): Promise<LibraryItem> {
    try {
      const { origin, destination } = params;
      const dest = destination.trim();
      const destinationPathArray = dest.split('/');

      if (destinationPathArray.length > 1) {
        destinationPathArray.pop();
        const destinationPathFolder = destinationPathArray.join('/');
        const destinationDB = await this.dbGetLibrary(
          user.id_user,
          destinationPathFolder,
          { exactly: true },
        );
        if (destinationDB.length !== 1) {
          throw Error('destination not found');
        }
        const destType = `${destinationDB[0].type}`;
        if (
          destType !== LibraryItemType.FOLDER &&
          destType !== LibraryItemType.BOUND
        ) {
          throw Error('The destination is invalid');
        }
      }
      const originObj = await this.dbGetLibrary(user.id_user, origin);
      if (originObj.length !== 1) {
        throw Error('origin is invalid');
      }

      const sourceKey = `${user.email}/${originObj[0].key}`;
      const targetKey = `${user.email}/${dest}`;
      const moved = await this._storage.copyFile(sourceKey, targetKey, true);

      if (!moved) {
        throw Error('error moving the book');
      }

      const itemDbInserted = await this.dbUpdateLibraryItem(
        user.id_user,
        originObj[0].key,
        {
          ...originObj[0],
          key: dest,
        },
      );
      const item = (await this.ParseLibraryItemDbB(
        itemDbInserted,
        LibraryItemOutput.API,
      )) as LibraryItem;

      return item;
    } catch (err) {
      console.log(err.message);
      throw Error(err);
    }
  }

  async deleteFolderMoving(user: User, folderPath: string): Promise<boolean> {
    try {
      const trx = await this.db.transaction();
      const folderDB = await this.dbGetLibrary(
        user.id_user,
        folderPath,
        { exactly: true },
        trx,
      );
      if (!folderDB[0]) {
        throw Error('folder not found');
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
      const allFilesInside = await this.dbGetLibrary(
        user.id_user,
        `${folderPath}/`,
      );
      const dbMoved = await this.dbMoveFilesUp(user.id_user, folderPath, trx);
      for (let index = 0; index < dbMoved.length; index++) {
        const fileMoved = dbMoved[index];
        if (`${fileMoved.type}` === LibraryItemType.BOOK) {
          const prevFile = allFilesInside.find(
            (preFile) => preFile.id_library_item === fileMoved.id_library_item,
          );
          const sourceKey = `${user.email}/${prevFile.key}`;
          const targetKey = `${user.email}/${fileMoved.key}`;
          await this._storage.copyFile(sourceKey, targetKey, true);
        }
      }
      // throw new Error('error');
      await trx.commit();
      return true;
    } catch (err) {
      throw Error(err.message);
    }
  }

  async dbGetLastItemPlayed(
    user: User,
    withPresign?: boolean,
    trx?: Knex.Transaction,
  ): Promise<LibraryItem> {
    try {
      const db = trx || this.db;
      const itemDb = await db('library_items as li')
        .where({
          user_id: user.id_user,
          active: true,
        })
        .andWhereRaw('last_play_date is not null')
        .orderBy('last_play_date', 'desc')
        .first()
        .debug(false);

      const item = (await this.ParseLibraryItemDbB(
        itemDb,
        LibraryItemOutput.API,
      )) as LibraryItem;
      if (withPresign) {
        item.url = await this._storage.GetPresignedUrl(
          `${user.email}/${itemDb.key}`,
          S3Action.GET,
        );
      }
      return item;
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }
}
