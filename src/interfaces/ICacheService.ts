export interface ICacheService {
  connectCacheService(): void;
  setObject(key: string, obj: object): Promise<string>;
  getObject(key: string): Promise<object>;
  deleteObject(key: string): Promise<boolean>;
}
