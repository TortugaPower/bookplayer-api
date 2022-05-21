import { inject, injectable } from 'inversify';
import { LibrarItemDB, LibraryItem, User } from '../types/user';
import { Knex } from 'knex';
import database from '../database';
import { TYPES } from '../ContainerTypes';
import { IStorageService } from '../interfaces/IStorageService';

@injectable()
export class LibraryService {
  @inject(TYPES.StorageService)
  private _storage: IStorageService;
  private db = database;

  async dbGetLibrary(user_id: number, path: string, trx?: Knex.Transaction): Promise<LibrarItemDB[]> {
    try {
      const db = trx || this.db;
      const pathNumber = path.split('/').length;
      const objects = await db('library_items as li')
        .where({
          user_id,
          active: true,
        })
        .whereRaw("array_length(string_to_array(key, '/'), 1) = ?", [pathNumber])
        .whereRaw("key like ?", [`${path}%`]).debug(false);

      return objects;
    } catch(err)  {
      console.log(err.message);
      return null;
    } 
  }


  async GetLibrary(user: User, path: string, trx?: Knex.Transaction): Promise<LibraryItem[]> {
    try {
      const storageObjects = await this._storage.GetDirectoryContent(path);
      const cleanPath = path.replace(`${user.email}/`,'');
      const objectDB = await this.dbGetLibrary(user.id_user, cleanPath);
      const library: LibraryItem[] = [];
      if (storageObjects?.length) {
        storageObjects.forEach(obj => {
          const itemDb = objectDB.find(item => obj.Key.indexOf(item.key) !== -1);
          if (itemDb) {
            library.push({
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
            })
          }   
        });
      }
      return library;
    } catch(err)  {
      console.log(err.message);
      return null;
    }
  }
}