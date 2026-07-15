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
        .orderBy('key', 'asc');
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
        .orderBy('order_rank', 'asc');
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
        .orderBy('order_rank', 'asc');
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
  private static escapeLikePrefix(prefix: string): string {
    // Keys routinely contain `_` (a LIKE wildcard); escape so a folder named
    // "My_Books" can't match a sibling "MyXBooks" subtree.
    return prefix.replace(/[\\%_]/g, (m) => `\\${m}`);
  }

  /**
   * The single subtree key-rewrite primitive: relocate every active row under
   * `oldPrefix/` (and, with `includeSelf`, the row whose key IS `oldPrefix`)
   * to the same position under `newPrefix`. All move/rename/promote flows are
   * prefix replacements, so they all funnel through here — this is the only
   * place that builds the match set (wildcard-escaped, '/'-boundary-correct:
   * same-prefix siblings like "Series 2" are never captured by "Series").
   *
   * `collisionWinner` decides who survives when a computed destination key is
   * already held by an active row:
   * - 'mover': the row being moved wins; the occupant is deactivated
   *   (explicit user-initiated moves/renames — the mover is canonical).
   * - 'occupant': the occupant wins; the stale mover is deactivated
   *   (upload move-fallback — destination rows are the client's re-created
   *   state and may own newer uploads).
   * Deactivation nulls the uuid to free both partial unique indexes, matching
   * the dedupe migration.
   *
   * Returns the rewritten rows including `old_key`. Throws on error — run it
   * inside a transaction that rolls back as a unit; public wrappers keep their
   * catch/log/null contracts.
   */
  private async rewriteKeyPrefix(
    user_id: number,
    oldPrefix: string,
    newPrefix: string,
    opts: { includeSelf: boolean; collisionWinner: 'mover' | 'occupant' },
    db: Knex | Knex.Transaction,
  ): Promise<LibraryItemMovedDB[]> {
    if (opts.includeSelf && newPrefix === '') {
      throw new Error('rewriteKeyPrefix: includeSelf requires a non-empty newPrefix');
    }

    const escapedChildPattern = `${LibraryDB.escapeLikePrefix(oldPrefix)}/%`;

    // Children keep everything after the old prefix; an empty newPrefix also
    // swallows the separator so promote-to-root never yields a leading '/'.
    const childKeySql =
      newPrefix === ''
        ? `substr(key, length(cast(? as text)) + 2)`
        : `concat(cast(? as text), substr(key, length(cast(? as text)) + 1))`;
    const childKeyParams =
      newPrefix === '' ? [oldPrefix] : [newPrefix, oldPrefix];

    const matchSql = opts.includeSelf
      ? `(key = cast(? as text) or key like ? escape '\\')`
      : `key like ? escape '\\'`;
    const matchParams = opts.includeSelf
      ? [oldPrefix, escapedChildPattern]
      : [escapedChildPattern];

    const moversSql = `
      select id_library_item, key as old_key,
             case when key = cast(? as text) then cast(? as text)
                  else ${childKeySql} end as new_key
      from library_items
      where user_id = ? and active = true and ${matchSql}
    `;
    const moversParams = [
      oldPrefix,
      newPrefix,
      ...childKeyParams,
      user_id,
      ...matchParams,
    ];

    if (opts.collisionWinner === 'mover') {
      await db.raw(
        `
        with movers as (${moversSql})
        update library_items
        set active = false, uuid = null, updated_at = now()
        where user_id = ? and active = true
          and key in (select new_key from movers)
          and id_library_item not in (select id_library_item from movers);
        `,
        [...moversParams, user_id],
      );
    } else {
      await db.raw(
        `
        with movers as (${moversSql})
        update library_items li
        set active = false, uuid = null, updated_at = now()
        from movers m
        join library_items dest
          on dest.user_id = ? and dest.active = true and dest.key = m.new_key
        where li.id_library_item = m.id_library_item;
        `,
        [...moversParams, user_id],
      );
    }

    const moved = await db.raw(
      `
      with movers as (${moversSql})
      update library_items li
      set key = m.new_key, updated_at = now()
      from movers m
      where li.id_library_item = m.id_library_item and li.active = true
      returning li.id_library_item, li.key, m.old_key, li.type, li.original_filename, li.source_path;
      `,
      moversParams,
    );
    return moved.rows;
  }

  async moveFiles(
    user_id: number,
    origin: string,
    destination: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemMovedDB[]> {
    try {
      const db = trx || this.db;
      // Nest origin INSIDE destination: its last segment becomes the new key
      const lastSegment = origin.split('/').pop();
      const newKey =
        destination !== '' ? `${destination}/${lastSegment}` : lastSegment;
      return await this.rewriteKeyPrefix(
        user_id,
        origin,
        newKey,
        { includeSelf: true, collisionWinner: 'mover' },
        db,
      );
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
      // destination is the item's full new key: origin prefix is REPLACED
      return await this.rewriteKeyPrefix(
        user_id,
        origin,
        destination,
        { includeSelf: true, collisionWinner: 'mover' },
        db,
      );
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.renameFiles',
        message: err.message,
        data: { user_id, origin, destination },
      });
      return null;
    }
  }

  /**
   * Children-only variant of renameFiles for the rename merge path: the
   * origin folder row must stay put (the service soft-deletes it and keeps
   * the pre-existing destination folder), only its subtree moves under the
   * destination key.
   */
  async moveFolderChildren(
    user_id: number,
    origin: string,
    destination: string,
    trx?: Knex.Transaction,
  ): Promise<LibraryItemMovedDB[]> {
    try {
      const db = trx || this.db;
      return await this.rewriteKeyPrefix(
        user_id,
        origin,
        destination,
        { includeSelf: false, collisionWinner: 'mover' },
        db,
      );
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.moveFolderChildren',
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
  ): Promise<LibraryItemMovedDB[]> {
    try {
      const db = trx || this.db;
      // Children only (the folder row is soft-deleted by the caller):
      // promote them into the folder's parent, or the root
      const parentSegments = folderPath.split('/');
      parentSegments.pop();
      const parentPrefix = parentSegments.join('/');
      return await this.rewriteKeyPrefix(
        user_id,
        folderPath,
        parentPrefix,
        { includeSelf: false, collisionWinner: 'mover' },
        db,
      );
    } catch (err) {
      this._logger.log({
        origin: 'LibraryDB.moveFilesUp',
        message: err.message,
        data: { user_id, folderPath },
      });
      return null;
    }
  }

  /**
   * Relocate a single item — and, for container types, its subtree — to an
   * exact new key. Used by the upload uuid-fallback in putObject: the client
   * moved the item locally and is re-uploading it at the new path.
   *
   * Collision semantics are the OPPOSITE of moveFiles/renameFiles: when a
   * child's rewritten key is already taken by an active row, the occupant wins
   * and the stale old-path child is deactivated (uuid nulled to free the
   * partial unique indexes) — destination rows are the client's re-created
   * state and may own newer uploads.
   *
   * Throws on error instead of returning null: this runs inside the caller's
   * transaction, which must roll back as a unit.
   */
  async moveItemToKey(
    user_id: number,
    id_library_item: number,
    oldKey: string,
    newKey: string,
    moveChildren: boolean,
    trx: Knex.Transaction,
  ): Promise<LibraryItemDB | null> {
    if (moveChildren) {
      await this.rewriteKeyPrefix(
        user_id,
        oldKey,
        newKey,
        { includeSelf: false, collisionWinner: 'occupant' },
        trx,
      );
    }

    // The caller resolved the row by uuid and needs it back in full, so the
    // self update stays by id with returning('*')
    const moved = await trx('library_items')
      .update({ key: newKey, updated_at: trx.fn.now() })
      .where({ id_library_item, user_id, active: true })
      .returning('*');
    return moved[0] || null;
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
          // Spread so an absent value falls back to the column default —
          // callers like moveLibraryObject's folder auto-create pass
          // synced: true and it must not be silently dropped
          ...(item.synced !== undefined ? { synced: item.synced } : {}),
        })
        .onConflict()
        .ignore()
        .returning('*');
      if (objects[0]) return objects[0];

      const existing = await db('library_items as li')
        .where({ user_id, key: item.key, active: true })
        .first();
      if (!existing) {
        // onConflict().ignore() maps to ON CONFLICT DO NOTHING with no target,
        // so it swallows ANY unique violation — including
        // library_items_uuid_user_unique (the same uuid active at a DIFFERENT
        // key), which the (user_id, key) refetch can't see. putObject resolves
        // that case as a move before inserting, so landing here means a race
        // or corrupted state; the uuid in the breadcrumb is the first suspect.
        this._logger.log(
          {
            origin: 'LibraryDB.insertLibraryItem',
            message:
              'Insert conflict resolved but refetch found no winner (possible library_items_uuid_user_unique conflict)',
            data: { user_id, key: item.key, uuid: item.uuid },
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
        .first();
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
      .whereBetween('order_rank', orderRange);
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
      // Scoped only by library_item_id: assumes a single external source per
      // item. The schema permits multiple active providers per item (unique
      // index on library_item_id, provider_name, provider_id), so if concurrent
      // multi-provider items become a real scenario, `external_set` must carry
      // the provider and this update must scope to it — otherwise confirming one
      // upload marks every provider 'downloaded'.
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
        });
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
        .where({ active: true });
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
