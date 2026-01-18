import { createClient } from 'redis';
import { inject, injectable } from 'inversify';
import { RedisClientType } from '@redis/client';
import { ILoggerService } from '../interfaces/ILoggerService';
import { TYPES } from '../ContainerTypes';

@injectable()
export class RedisService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  private static client: RedisClientType;

  async connectCacheService() {
    try {
      if (!RedisService.client) {
        RedisService.client = createClient({
          url: process.env.REDIS_URL,
        });
      }
      RedisService.client.connect();
      RedisService.client.on('error', (err) => {
        this._logger.log({
          origin: 'connectCacheService',
          error: 'Redis client error connection',
          err: err.message,
        });
      });
      this._logger.log({
        origin: 'connectCacheService',
        message: 'Cache is connected',
      });
    } catch (err) {
      this._logger.log({
        origin: 'connectCacheService',
        error: 'Redis client error connection',
        err: err.message,
      });
    }
  }
  async setObject(key: string, obj: object): Promise<string> {
    try {
      const idObj = await RedisService.client.set(
        process.env.REDIS_ENV + key,
        JSON.stringify(obj),
      );
      return idObj;
    } catch (err) {
      this._logger.log({ origin: 'RedisService.setObject', message: err.message, data: { key } }, 'error');
      return null;
    }
  }
  async getObject(key: string): Promise<object> {
    try {
      const jsonObj = await RedisService.client.get(
        process.env.REDIS_ENV + key,
      );
      if (!jsonObj) {
        throw Error('Object not found');
      }
      return JSON.parse(jsonObj);
    } catch (err) {
      this._logger.log({ origin: 'RedisService.getObject', message: err.message, data: { key } }, 'error');
      return null;
    }
  }
  async deleteObject(key: string): Promise<boolean> {
    try {
      await RedisService.client.del(process.env.REDIS_ENV + key);
      return true;
    } catch (err) {
      this._logger.log({ origin: 'RedisService.deleteObject', message: err.message, data: { key } }, 'error');
      return false;
    }
  }
}
