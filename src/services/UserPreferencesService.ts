/**
 * UserPreferencesService
 *
 * Orchestrates user-preference reads/writes with input validation and
 * transaction wrapping. Validates key format (`KEY_REGEX`), value shape
 * (must be a JSON object), and batch size (`MAX_BATCH_SIZE`). All errors
 * are logged via the standard logger and surfaced as `null` returns.
 *
 * Rate limit: routes inherit the global limiter (200 req/min per IP)
 * plus the 64-entry per-request batch cap enforced here.
 */
import database from '../database';
import { logger } from './LoggerService';
import {
  UserPreferenceRow,
  UserPreferenceUpsert,
  UserPreferencesDB,
} from './db/UserPreferencesDB';

const KEY_REGEX = /^[a-z0-9_:.-]{1,128}$/i;
const MAX_BATCH_SIZE = 64;

export class UserPreferencesService {
  private readonly _logger = logger;
  private db = database;

  constructor(
    private _prefsDB: UserPreferencesDB = new UserPreferencesDB(),
  ) {}

  async getPreferences(
    user_id: number,
    keyPrefix?: string,
  ): Promise<UserPreferenceRow[] | null> {
    try {
      return await this._prefsDB.getAllByUserId(user_id, keyPrefix);
    } catch (err) {
      this._logger.log({
        origin: 'UserPreferencesService.getPreferences',
        message: err.message,
        data: { user_id, keyPrefix },
      });
      return null;
    }
  }

  async upsertPreferences(
    user_id: number,
    entries: UserPreferenceUpsert[],
  ): Promise<boolean | null> {
    if (!Array.isArray(entries)) return null;
    if (entries.length === 0) return true;
    if (entries.length > MAX_BATCH_SIZE) {
      this._logger.log({
        origin: 'UserPreferencesService.upsertPreferences',
        message: 'rejected: entries exceed limit',
        data: { user_id, count: entries.length },
      });
      return null;
    }

    for (const entry of entries) {
      if (!this.isValidKey(entry?.key)) {
        // Don't log the rejected key — keys are user-supplied and could
        // include adversarial probes; logging only the user_id keeps logs
        // useful for triage without echoing the bad input back to CloudWatch.
        this._logger.log({
          origin: 'UserPreferencesService.upsertPreferences',
          message: 'rejected: invalid key format',
          data: { user_id },
        });
        return null;
      }
      if (!this.isValidValue(entry?.value)) {
        this._logger.log({
          origin: 'UserPreferencesService.upsertPreferences',
          message: 'rejected: invalid value type',
          data: { user_id },
        });
        return null;
      }
    }

    const tx = await this.db.transaction();
    try {
      const result = await this._prefsDB.upsertMany(user_id, entries, tx);
      if (result === null) {
        await tx.rollback();
        return null;
      }
      await tx.commit();
      return true;
    } catch (err) {
      await tx.rollback();
      this._logger.log({
        origin: 'UserPreferencesService.upsertPreferences',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  async deletePreferences(
    user_id: number,
    keys: string[],
  ): Promise<boolean | null> {
    if (!Array.isArray(keys)) return null;
    if (keys.length === 0) return true;
    if (keys.length > MAX_BATCH_SIZE) return null;

    for (const key of keys) {
      if (!this.isValidKey(key)) {
        this._logger.log({
          origin: 'UserPreferencesService.deletePreferences',
          message: 'rejected: invalid key format',
          data: { user_id },
        });
        return null;
      }
    }

    return await this._prefsDB.softDeleteKeys(user_id, keys);
  }

  private isValidKey(key: unknown): key is string {
    return (
      typeof key === 'string' &&
      key.length > 0 &&
      key.length <= 128 &&
      KEY_REGEX.test(key)
    );
  }

  private isValidValue(value: unknown): boolean {
    return (
      typeof value === 'object' && value !== null && !Array.isArray(value)
    );
  }
}
