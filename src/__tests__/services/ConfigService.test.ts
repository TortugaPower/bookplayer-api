import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConfigService, ConfigKey } from '../../services/ConfigService';
import { mockLoggerService } from '../setup';

describe('ConfigService', () => {
  let service: ConfigService;
  let cache: any;
  let configDB: any;

  const KEY = ConfigKey.UseCloudFrontDownloads;
  const CACHE_KEY = `config_${KEY}`;

  beforeEach(() => {
    cache = {
      getObject: jest.fn(),
      setObject: jest.fn(),
      deleteObject: jest.fn(),
    };
    configDB = { getConfig: jest.fn() };
    service = new ConfigService();
    (service as any)._cache = cache;
    (service as any)._configDB = configDB;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('returns true when the flag row is "true"', async () => {
    cache.getObject.mockResolvedValue(null);
    configDB.getConfig.mockResolvedValue({
      value: 'true',
      value_type: 'boolean',
    });

    expect(await service.getBoolean(KEY)).toBe(true);
  });

  it('returns false when the flag row is "false"', async () => {
    cache.getObject.mockResolvedValue(null);
    configDB.getConfig.mockResolvedValue({
      value: 'false',
      value_type: 'boolean',
    });

    expect(await service.getBoolean(KEY)).toBe(false);
  });

  it('caches the row on a miss', async () => {
    cache.getObject.mockResolvedValue(null);
    const row = { value: 'true', value_type: 'boolean' };
    configDB.getConfig.mockResolvedValue(row);

    await service.getBoolean(KEY);

    expect(cache.setObject).toHaveBeenCalledWith(CACHE_KEY, row, 300);
  });

  it('uses a cache hit without touching the DB', async () => {
    cache.getObject.mockResolvedValue({ value: 'true', value_type: 'boolean' });

    expect(await service.getBoolean(KEY)).toBe(true);
    expect(configDB.getConfig).not.toHaveBeenCalled();
    expect(cache.setObject).not.toHaveBeenCalled();
  });

  it('fails safe to fallback when the row is missing', async () => {
    cache.getObject.mockResolvedValue(null);
    configDB.getConfig.mockResolvedValue(null);

    expect(await service.getBoolean(KEY)).toBe(false);
    expect(await service.getBoolean(KEY, true)).toBe(true);
  });

  it('fails safe (and warns) on a value_type mismatch', async () => {
    cache.getObject.mockResolvedValue(null);
    configDB.getConfig.mockResolvedValue({
      value: 'true',
      value_type: 'string',
    });

    expect(await service.getBoolean(KEY)).toBe(false);
    expect(mockLoggerService.log).toHaveBeenCalled();
  });

  it('fails safe to fallback on cache/DB error', async () => {
    cache.getObject.mockRejectedValue(new Error('valkey down'));

    expect(await service.getBoolean(KEY)).toBe(false);
  });

  it('invalidate() deletes the cached config', async () => {
    await service.invalidate(KEY);
    expect(cache.deleteObject).toHaveBeenCalledWith(CACHE_KEY);
  });
});
