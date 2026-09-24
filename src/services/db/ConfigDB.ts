import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';

export type ConfigValueType = 'boolean' | 'string' | 'object' | 'number';

export interface ConfigRow {
  value: string;
  value_type: ConfigValueType;
}

/**
 * Reads the `configs` table (global app config: key + string value + type).
 * Owns every `db('configs')` query; returns null on error after logging.
 */
export class ConfigDB {
  private readonly _logger = logger;
  private db = database;

  async getConfig(
    config: string,
    trx?: Knex.Transaction,
  ): Promise<ConfigRow | null> {
    try {
      const db = trx || this.db;
      const row = await db('configs')
        .select('value', 'value_type')
        .where({ config, active: true })
        .first();
      return row || null;
    } catch (err) {
      this._logger.log({
        origin: 'ConfigDB.getConfig',
        message: err.message,
        data: { config },
      });
      return null;
    }
  }
}
