import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';
import {
  Bookmark,
  ExternalResource,
  ExternalResourceDb,
  ItemMatchPayload,
  LibraryItemDB,
  LibraryItemMovedDB,
} from '../../types/user';
import { isValidUUID } from '../../utils';

// Map a snake_case external_resources row to the camelCase wire contract.
export function externalResourceRowToApi(row: ExternalResourceDb): ExternalResource {
  return {
    providerName: row.provider_name,
    providerId: row.provider_id,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at,
    processedFile: row.processed_file,
    hostId: row.host_id ?? null,
  };
}

// Map the camelCase wire contract to a snake_case row for insert.
function externalResourceToRow(
  resource: ExternalResource,
  libraryItemId: number,
): Omit<ExternalResourceDb, 'id' | 'active' | 'created_at' | 'updated_at'> {
  return {
    library_item_id: libraryItemId,
    provider_name: resource.providerName,
    provider_id: resource.providerId,
    sync_status: resource.syncStatus,
    last_synced_at: resource.lastSyncedAt,
    processed_file: resource.processedFile,
    host_id: resource.hostId ?? null,
  };
}

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
        .where({ user_id, uuid, active: true })
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

  /// Source-wins merge helper: deactivate any active row whose key matches a key
  /// the movers (rows whose current key matches `originLikePattern`) are about to
  /// rewrite to, excluding the movers themselves. Without this, the partial unique
  /// index on (user_id, key) WHERE active=true would make any subsequent bulk-key
  /// UPDATE fail when the destination subtree overlaps existing rows.
  ///
  /// `newKeySql` is the SQL expression that computes the destination key from the
  /// `removing` array and `removeIndex` scalar (both defined in the inner SELECT).
  /// `newKeyParams` carries any `?` placeholders the expression uses, in order.
  private async deactivateConflictingDestinations(
    user_id: number,
    removeIndexBasis: string,
    originLikePattern: string,
    newKeySql: string,
    newKeyParams: unknown[],
    db: Knex | Knex.Transaction,
  ): Promise<void> {
    await db.raw(
      `
      with movers as (
        select id_library_item, ${newKeySql} as new_key
        from (
          select id_library_item,
                 string_to_array(key, '/') as removing,
                 array_length(string_to_array(?, '/'), 1) as removeIndex
          from library_items
          where user_id=? and active=true and key like ?
        ) as sub
      )
      update library_items
      set active=false, uuid=null, updated_at=now()
      where user_id=?
        and active=true
        and key in (select new_key from movers)
        and id_library_item not in (select id_library_item from movers);
      `,
      [...newKeyParams, removeIndexBasis, user_id, originLikePattern, user_id],
    );
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

      await this.deactivateConflictingDestinations(
        user_id,
        origin,
        `${origin}%`,
        `concat(cast(? as text), array_to_string(removing[removeIndex:array_length(removing, 1)], '/'))`,
        [destinationPath],
        db,
      );

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

      await this.deactivateConflictingDestinations(
        user_id,
        origin,
        `${origin}%`,
        `concat(
          cast(? as text),
          case when array_to_string(removing[removeIndex::int + 1:array_length(removing, 1)], '') != '' then '/' else '' end,
          array_to_string(removing[removeIndex::int + 1:array_length(removing, 1)], '/')
        )`,
        [destination],
        db,
      );

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

      await this.deactivateConflictingDestinations(
        user_id,
        folderPath,
        `${folderPath}/%`,
        `array_to_string(removing[1:removeIndex-1] || removing[removeIndex+1:], '/')`,
        [],
        db,
      );

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
  ): Promise<LibraryItemDB | null> {
    try {
      const db = trx || this.db;
      // Partial unique index on (user_id, key) WHERE active = true means a race
      // between two concurrent inserts for the same key will silently no-op the
      // loser; refetch picks up the winning row so the caller always gets the
      // canonical record.
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
        .onConflict()
        .ignore()
        .returning('*');
      if (objects[0]) return objects[0];

      const existing = await db('library_items as li')
        .where({ user_id, key: item.key, active: true })
        .first();
      if (!existing) {
        // Shouldn't be reachable: the conflict path implies an active row at
        // (user_id, key), and the partial unique index guarantees at most one.
        // Logging so we have a breadcrumb if something exotic (e.g. a third
        // concurrent tx deactivated the winner) ever produces this state.
        this._logger.log(
          {
            origin: 'LibraryDB.insertLibraryItem',
            message: 'Insert conflict resolved but refetch found no winner',
            data: { user_id, key: item.key },
          },
          'warn',
        );
      }
      return existing || null;
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
        ? { user_id, uuid: uuid as string, active: true }
        : { user_id, key, active: true };
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
      .where({ user_id: params.user_id, key: params.key, active: true });
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
      .where({ user_id: params.user_id, active: true })
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

  async markExternalSourceUploaded(
    libraryItemId: number,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const runner = async (tx: Knex.Transaction): Promise<boolean> => {
      const idExternal = await tx('external_resources')
        .update({ sync_status: 'downloaded' })
        .where({ library_item_id: libraryItemId })
        .returning('library_item_id');
      const idUpdated = await tx('library_items')
        .update({ synced: true })
        .where({ id_library_item: libraryItemId })
        .returning('id_library_item');
      return !!idExternal[0]?.library_item_id && !!idUpdated[0]?.id_library_item;
    };
    try {
      if (trx) {
        return await runner(trx);
      }
      return await this.db.transaction(runner);
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.markExternalSourceUploaded',
        message: err.message,
        data: { libraryItemId },
      });
      return false;
    }
  }

  async getExternalResource(
    libraryItemId: number,
    providerId: string,
    providerName: string,
    trx?: Knex.Transaction,
  ): Promise<ExternalResourceDb | null> {
    try {
      const db = trx || this.db;
      const [object] = await db('external_resources')
        .where({
          library_item_id: libraryItemId,
          provider_id: providerId,
          provider_name: providerName,
          active: true,
        })
        .debug(false);
      return object;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.getExternalResource',
        message: err.message,
        data: { libraryItemId, providerId, providerName },
      });
      return null;
    }
  }

  async getExternalResources(
    libraryItemIds: number[],
    trx?: Knex.Transaction,
  ): Promise<ExternalResourceDb[] | null> {
    try {
      const db = trx || this.db;
      const objects = await db('external_resources')
        .whereIn('library_item_id', libraryItemIds)
        .where({ active: true })
        .debug(false);
      return objects as ExternalResourceDb[];
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.getExternalResources',
        message: err.message,
        data: { libraryItemIds },
      });
      return null;
    }
  }

  async insertExternalResource(
    libraryItemId: number,
    externalResource: ExternalResource,
    trx?: Knex.Transaction,
  ): Promise<ExternalResourceDb | null> {
    try {
      const db = trx || this.db;
      const rowToInsert = externalResourceToRow(externalResource, libraryItemId);
      const [newRow] = await db('external_resources')
        .insert(rowToInsert)
        .returning('*');
      return (newRow as ExternalResourceDb) || null;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.insertExternalResource',
        message: err.message,
        data: { libraryItemId, externalResource },
      });
      return null;
    }
  }

  async softDeleteExternalResource(
    libraryItemId: number,
    providerId: string,
    providerName: string,
    trx?: Knex.Transaction,
  ): Promise<ExternalResourceDb | null> {
    try {
      const db = trx || this.db;
      const [updatedRow] = await db('external_resources')
        .where({
          library_item_id: libraryItemId,
          provider_id: providerId,
          provider_name: providerName,
          active: true,
        })
        .update({ active: false, updated_at: new Date() })
        .returning('*');
      return (updatedRow as ExternalResourceDb) || null;
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.softDeleteExternalResource',
        message: err.message,
        data: { libraryItemId, providerId, providerName },
      });
      return null;
    }
  }
}
