import { createClient } from 'redis';
import { injectable } from 'inversify';
import { RedisClientType } from '@redis/client';

@injectable()
export class RedisService {
  private static client: RedisClientType;

  async connectCacheService() {
    try {
      if (!RedisService.client) {
        RedisService.client = createClient({
          url: process.env.REDIS_URL,
        });
      }
      RedisService.client.connect();
      RedisService.client.on('error', (err) =>
        console.log('Redis Client Error', err),
      );
      console.log('Cache is connected');
    } catch (err) {
      console.log('Redis client error connection', err);
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
      return null;
    }
  }
  async deleteObject(key: string): Promise<boolean> {
    try {
      await RedisService.client.del(process.env.REDIS_ENV + key);
      return true;
    } catch (err) {
      return false;
    }
  }
}
