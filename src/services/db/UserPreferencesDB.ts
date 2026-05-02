/**
 * UserPreferencesDB
 *
 * Owns all queries against the `user_preferences` table. Each method scopes
 * by `user_id` for isolation and accepts an optional Knex transaction so
 * the service layer can compose multiple operations atomically. Methods
 * return `null` after logging on error (codebase convention).
 */
import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';

export type UserPreferenceRow = {
  key: string;
  value: object;
  updated_at: Date;
};

export type UserPreferenceUpsert = {
  key: string;
  value: object;
};

export class UserPreferencesDB {
  private readonly _logger = logger;
  private db = database;

  async getAllByUserId(
    user_id: number,
    keyPrefix?: string,
    trx?: Knex.Transaction,
  ): Promise<UserPreferenceRow[] | null> {
    try {
      const db = trx || this.db;
      const query = db('user_preferences')
        .select('key', 'value', 'updated_at')
        .where({ user_id, active: true });

      if (keyPrefix) {
        query.andWhere('key', 'like', `${keyPrefix}%`);
      }

      return await query.orderBy('key');
    } catch (err) {
      this._logger.log({
        origin: 'UserPreferencesDB.getAllByUserId',
        message: err.message,
        data: { user_id, keyPrefix },
      });
      return null;
    }
  }

  async upsertMany(
    user_id: number,
    entries: UserPreferenceUpsert[],
    trx?: Knex.Transaction,
  ): Promise<boolean | null> {
    try {
      const db = trx || this.db;
      const rows = entries.map(({ key, value }) => ({
        user_id,
        key,
        value: JSON.stringify(value),
        active: true,
        updated_at: db.fn.now(),
      }));

      await db('user_preferences')
        .insert(rows)
        .onConflict(['user_id', 'key'])
        .merge(['value', 'updated_at', 'active']);

      return true;
    } catch (err) {
      this._logger.log({
        origin: 'UserPreferencesDB.upsertMany',
        message: err.message,
        data: { user_id, entryCount: entries.length },
      });
      return null;
    }
  }

  async softDeleteKeys(
    user_id: number,
    keys: string[],
    trx?: Knex.Transaction,
  ): Promise<boolean | null> {
    try {
      const db = trx || this.db;
      await db('user_preferences')
        .where({ user_id })
        .whereIn('key', keys)
        .update({ active: false, updated_at: db.fn.now() });
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'UserPreferencesDB.softDeleteKeys',
        message: err.message,
        data: { user_id, keyCount: keys.length },
      });
      return null;
    }
  }
}
