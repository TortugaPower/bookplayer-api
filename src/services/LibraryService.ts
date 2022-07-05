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
        .whereRaw('key like ?', [`${path}%`])
        .debug(true);
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
        .whereRaw('key like ?', [`${path}%`])
        .returning('*');
      return objectsDeleted;
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
          speed: item.speed,
          actual_time: item.actual_time,
          duration: item.duration,
          percent_completed: item.percent_completed,
          order_rank: item.order_rank,
          last_play_date: item.last_play_date,
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
      if (storageObjects?.length) {
        for (let index = 0; index < storageObjects.length; index++) {
          const obj = storageObjects[index];
          const itemDb = objectDB.find(
            (item) => obj.Key.indexOf(item.key) !== -1,
          );
          if (itemDb) {
            const libObj: LibraryItem = {
              relativePath: itemDb.key,
              originalFileName: itemDb.title,
              title: itemDb.title,
              details: '',
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
          originalFileName: itemTemp.title,
          title: itemTemp.title,
          details: '',
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
          speed: itemApi.speed,
          actual_time: `${itemApi.currentTime}`,
          duration: `${itemApi.currentTime}`,
          percent_completed: itemApi.percentCompleted,
          order_rank: itemApi.orderRank,
          last_play_date: itemApi.lastPlayDateTimestamp,
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
        throw Error('Item not exists');
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
      const url = await this._storage.GetPresignedUrl(
        `${user.email}/${relativePath}`,
        S3Action.PUT,
      );
      const libObj = (await this.ParseLibraryItemDbB(
        params,
        LibraryItemOutput.DB,
      )) as LibrarItemDB;
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
}
