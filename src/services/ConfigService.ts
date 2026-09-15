import { logger } from './LoggerService';
import { ConfigDB, ConfigRow } from './db/ConfigDB';
import { RedisService } from './RedisService';

/** Known keys in the `configs` table (mirrors the `param_config_type` enum). */
export enum ConfigKey {
  ForceFileProxy = 'force_file_proxy',
  UseCloudFrontDownloads = 'use_cloudfront_downloads',
}

/**
 * Reads global app config flags from the `configs` table, read-through cached
 * in ValKey/Redis (read-heavy, written only by a deliberate config change).
 *
 * Fails safe: any cache/DB error, missing row, or type mismatch returns the
 * caller's fallback (default `false`) so an outage never silently flips a
 * feature on. Invalidate the cache after changing a row.
 */
export class ConfigService {
  private readonly _logger = logger;
  // 5 min: config flags are written rarely but need to take effect quickly
  // after a change (e.g. flipping use_cloudfront_downloads). invalidate() clears
  // it immediately when you can't wait for the TTL.
  private static readonly CACHE_TTL_SECONDS = 300;

  constructor(
    private _configDB: ConfigDB = new ConfigDB(),
    private _cache: RedisService = new RedisService(),
  ) {}

  async getBoolean(key: ConfigKey, fallback = false): Promise<boolean> {
    try {
      const cacheKey = this.cacheKey(key);
      const cached = (await this._cache.getObject(
        cacheKey,
      )) as ConfigRow | null;
      const row = cached || (await this._configDB.getConfig(key));
      if (!row) return fallback;
      if (!cached) {
        await this._cache.setObject(
          cacheKey,
          row,
          ConfigService.CACHE_TTL_SECONDS,
        );
      }
      if (row.value_type !== 'boolean') {
        this._logger.log(
          {
            origin: 'ConfigService.getBoolean',
            message: `config '${key}' is '${row.value_type}', expected boolean`,
          },
          'warn',
        );
        return fallback;
      }
      return row.value === 'true';
    } catch (err) {
      this._logger.log(
        {
          origin: 'ConfigService.getBoolean',
          message: err.message,
          data: { key },
        },
        'error',
      );
      return fallback;
    }
  }

  /** Invalidate a cached config after the row is changed. */
  async invalidate(key: ConfigKey): Promise<void> {
    await this._cache.deleteObject(this.cacheKey(key));
  }

  private cacheKey(key: ConfigKey): string {
    return `config_${key}`;
  }
}
