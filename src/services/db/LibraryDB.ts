import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';
import {
  Bookmark,
  ItemMatchPayload,
  LibraryItemDB,
  LibraryItemMovedDB,
} from '../../types/user';
import { isValidUUID } from '../../utils';

export class LibraryDB {
  private readonly _logger = logger;
  private db = database;

  async getAllKeys(user_id: number, trx?: Knex.Transaction): Promise<string[]> {
    try {
      const db = trx || this.db;
      const objects = await db('library_items as li')
        .where({ user_id, active: true, synced: true })
        .orderBy('key', 'asc')
        .debug(false);
      return objects.map((item) => item.key);
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.getAllKeys',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  async getLibrary(
    user_id: number,
    path: string,
    filter?: { rawFilter?: string; exactly?: boolean },
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
    try {
      const db = trx || this.db;
      const pathNumber = path.split('/').length;
      const objects = await db('library_items as li')
        .where({ user_id, active: true })
        .whereRaw("array_length(string_to_array(key, '/'), 1) = ?", [pathNumber])
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
        origin: 'LibraryDB.getLibrary',
        message: err.message,
        data: { user_id, path, filter },
      });
      return null;
    }
  }

  async getLibraryByUuid(
    user_id: number,
    uuid: string,
    filter?: { rawFilter?: string; exactly?: boolean },
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
    try {
      const db = trx || this.db;
      const objects = await db('library_items as li')
        .where({ user_id, active: true, uuid })
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
        origin: 'LibraryDB.getLibraryByUuid',
        message: err.message,
        data: { user_id, uuid, filter },
      });
      return null;
    }
  }

  async getItemByThumbnail(
    user_id: number,
    thumbnail: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB> {
    try {
      const db = trx || this.db;
      const item = await db('library_items as li')
        .where({ user_id, active: true, thumbnail })
        .first();
      return item;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.getItemByThumbnail',
        message: err.message,
        data: { user_id, thumbnail },
      });
      return null;
    }
  }

  async deleteLibrary(
    params: {
      user_id: number;
      path: string;
      exactly?: boolean;
      active?: boolean;
    },
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
    try {
      const { user_id, path, exactly, active } = params;
      const db = trx || this.db;
      const objectsDeleted = await db('library_items as li')
        .update({ active: false })
        .where({ user_id, active: active === false ? active : true })
        .whereRaw('key like ?', [`${path}${exactly ? '' : '%'}`])
        .returning('*');
      return objectsDeleted;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.deleteLibrary',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async deleteLibraryByUuid(
    params: {
      user_id: number;
      uuid: string;
      exactly?: boolean;
      active?: boolean;
    },
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
    try {
      const { user_id, uuid, active, exactly } = params;
      if (!isValidUUID(uuid)) throw Error(`Invalid UUID ${uuid}. Wrong format`);
      const db = trx || this.db;
      const targetItem = await db('library_items')
        .select('key')
        .where({ user_id, uuid })
        .first();

      if (!targetItem) return [];

      const objectsDeleted = await db('library_items as li')
        .update({ active: false })
        .where({ user_id, active: active === false ? active : true })
        .whereRaw('key like ?', [`${targetItem.key}${exactly ? '' : '%'}`])
        .returning('*');
      return objectsDeleted;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.deleteLibraryByUuid',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async getNestedObjects(
    user_id: number,
    folderPath: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
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
        origin: 'LibraryDB.getNestedObjects',
        message: err.message,
        data: { user_id, folderPath },
      });
      return null;
    }
  }

  async moveFiles(
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
        origin: 'LibraryDB.moveFiles',
        message: err.message,
        data: { origin, destination },
      });
      return null;
    }
  }

  async renameFiles(
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
        origin: 'LibraryDB.renameFiles',
        message: err.message,
        data: { user_id, origin, destination },
      });
      return null;
    }
  }

  async moveFilesUp(
    user_id: number,
    folderPath: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
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
        origin: 'LibraryDB.moveFilesUp',
        message: err.message,
        data: { user_id, folderPath },
      });
      return null;
    }
  }

  async insertLibraryItem(
    user_id: number,
    item: LibraryItemDB,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB> {
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
          uuid: item.uuid,
        })
        .returning('*');
      return objects[0];
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.insertLibraryItem',
        message: err.message,
        data: { user_id, item },
      });
      return null;
    }
  }

  async updateLibraryItem(
    user_id: number,
    key: string,
    item: LibraryItemDB,
    uuid?: string,
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
      const whereClause = isValidUUID(uuid)
        ? { user_id, uuid: uuid as string }
        : { user_id, key };
      const updatedCount = await db('library_items')
        .update(updateObject)
        .where(whereClause);

      if (updatedCount !== 1)
        throw new Error(
          `Multiple rows (${updatedCount}) matched the update criteria.`,
        );
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.updateLibraryItem',
        message: err.message,
        data: { user_id, key, item },
      });
      return false;
    }
  }

  async getLastItemPlayed(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemDB> {
    try {
      const db = trx || this.db;
      const itemDb = await db('library_items as li')
        .where({ user_id, active: true })
        .andWhereNot('type', 0)
        .andWhereRaw('last_play_date is not null')
        .orderBy('last_play_date', 'desc')
        .first()
        .debug(false);
      return itemDb;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.getLastItemPlayed',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  async getBookmarks(
    params: { key?: string; uuid?: string; user_id: number },
    trx?: Knex.Transaction,
  ): Promise<Bookmark[]> {
    try {
      const { key, user_id, uuid } = params;
      const db = trx || this.db;
      const filter: (number | string)[] = [user_id];
      let whereFilter = '';
      if (uuid && isValidUUID(uuid)) {
        filter.push(uuid);
        whereFilter += ' and li.uuid=? ';
      } else if (key) {
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
        origin: 'LibraryDB.getBookmarks',
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
        .merge({ note: bookmark.note, active: bookmark.active })
        .returning(selectColumns);
      return updated[0];
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.upsertBookmark',
        message: err.message,
        data: { bookmark },
      });
      return null;
    }
  }

  // Queries for orchestrated (transactional) service methods

  async shiftOrderRanks(
    params: {
      user_id: number;
      path: string;
      pathDepth: number;
      orderRange: [number, number];
      direction: 'increment' | 'decrement';
    },
    trx: Knex.Transaction,
  ): Promise<void> {
    const { user_id, path, pathDepth, orderRange, direction } = params;
    const op = direction === 'increment' ? '+' : '-';
    await trx('library_items as li')
      .update({ order_rank: trx.raw(`order_rank ${op} 1`) })
      .where({ user_id, active: true })
      .whereRaw("array_length(string_to_array(key, '/'), 1) = ?", [pathDepth])
      .whereRaw('key like ?', [`${path}%`])
      .whereBetween('order_rank', orderRange)
      .debug(false);
  }

  async updateBySourcePath(
    params: { user_id: number; key: string; source_path: string },
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('library_items')
      .update({ source_path: params.source_path })
      .where({ user_id: params.user_id, key: params.key });
  }

  async updateFolderMergeFields(
    params: {
      id_library_item: number;
      duration: string;
      details: string;
      actual_time: string;
      percent_completed: number;
      last_play_date: number;
    },
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('library_items')
      .update({
        duration: params.duration,
        details: params.details,
        actual_time: params.actual_time,
        percent_completed: params.percent_completed,
        last_play_date: params.last_play_date,
      })
      .where({ id_library_item: params.id_library_item });
  }

  async softDeleteItem(
    id_library_item: number,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('library_items')
      .update({ active: false })
      .where({ id_library_item });
  }

  async renameItemTitle(
    params: { user_id: number; id_library_item: number; title: string },
    trx: Knex.Transaction,
  ): Promise<LibraryItemDB[]> {
    return trx('library_items')
      .update({ title: params.title })
      .where({
        user_id: params.user_id,
        id_library_item: params.id_library_item,
      })
      .returning('*');
  }

  async updateThumbnail(
    params: { id_library_item: number; thumbnail: string },
    trx?: Knex.Transaction,
  ): Promise<number | null> {
    try {
      const db = trx || this.db;
      const idUpdated = await db('library_items')
        .update({ thumbnail: params.thumbnail })
        .where({ id_library_item: params.id_library_item })
        .returning('id_library_item');
      return idUpdated[0]?.id_library_item ?? null;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.updateThumbnail',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async selectForUpdateByKeys(
    params: { user_id: number; keys: string[] },
    trx: Knex.Transaction,
  ): Promise<Array<{ key: string; uuid: string | null }>> {
    return trx('library_items')
      .select('key', 'uuid')
      .where({ user_id: params.user_id })
      .whereIn('key', params.keys)
      .forUpdate();
  }

  async setItemUuid(
    params: { user_id: number; key: string; uuid: string },
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('library_items')
      .where({ user_id: params.user_id, key: params.key, active: true })
      .update({ uuid: params.uuid });
  }
}
