import { createClient } from 'redis';
import { logger } from './LoggerService';

export class RedisService {
  private readonly _logger = logger;
  private static client: ReturnType<typeof createClient> | undefined;

  async connectCacheService(): Promise<void> {
    if (!process.env.REDIS_URL) {
      this._logger.log({
        origin: 'RedisService.connectCacheService',
        message: 'REDIS_URL not configured; cache disabled',
      }, 'warn');
      return;
    }
    if (RedisService.client) return;

    try {
      const client = createClient({
        url: process.env.REDIS_URL,
        socket: { connectTimeout: 10000 },
      });
      client.on('error', (err) => {
        this._logger.log({
          origin: 'RedisService.client',
          message: 'Redis connection error',
          data: { error: err.message },
        }, 'error');
      });
      await client.connect();
      RedisService.client = client;
      this._logger.log({
        origin: 'RedisService.connectCacheService',
        message: 'Cache connected',
      });
    } catch (err) {
      this._logger.log({
        origin: 'RedisService.connectCacheService',
        message: 'Cache connection failed; falling back to no-cache',
        data: { error: err.message },
      }, 'error');
      RedisService.client = undefined;
    }
  }
  async setObject(
    key: string,
    obj: object,
    ttlSeconds?: number,
  ): Promise<string | null> {
    if (!RedisService.client) return null;
    try {
      const fullKey = process.env.REDIS_ENV + key;
      const value = JSON.stringify(obj);
      const idObj = ttlSeconds && ttlSeconds > 0
        ? await RedisService.client.set(fullKey, value, { EX: ttlSeconds })
        : await RedisService.client.set(fullKey, value);
      return idObj;
    } catch (err) {
      this._logger.log({ origin: 'RedisService.setObject', message: err.message, data: { key } }, 'error');
      return null;
    }
  }
  async getObject(key: string): Promise<object> {
    if (!RedisService.client) return null;
    try {
      const jsonObj = await RedisService.client.get(
        process.env.REDIS_ENV + key,
      );
      if (!jsonObj) return null;
      return JSON.parse(jsonObj);
    } catch (err) {
      this._logger.log({ origin: 'RedisService.getObject', message: err.message, data: { key } }, 'error');
      return null;
    }
  }
  async deleteObject(key: string): Promise<boolean> {
    if (!RedisService.client) return false;
    try {
      await RedisService.client.del(process.env.REDIS_ENV + key);
      return true;
    } catch (err) {
      this._logger.log({ origin: 'RedisService.deleteObject', message: err.message, data: { key } }, 'error');
      return false;
    }
  }
}
