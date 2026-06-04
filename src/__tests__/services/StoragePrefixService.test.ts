import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { StoragePrefixService } from '../../services/StoragePrefixService';
import { mockLoggerService } from '../setup';

describe('StoragePrefixService', () => {
  let service: StoragePrefixService;
  let cache: any;
  let userDB: any;

  const RELAY = 'relay@privaterelay.appleid.com';
  const EXTERNAL_ID = 'apple.sub.123';

  const makeUser = (over: object = {}) => ({
    id_user: 67662,
    email: RELAY,
    external_id: EXTERNAL_ID,
    ...over,
  });

  beforeEach(() => {
    cache = {
      getObject: jest.fn(),
      setObject: jest.fn(),
      deleteObject: jest.fn(),
    };
    userDB = { getStorageConfig: jest.fn() };
    service = new StoragePrefixService();
    (service as any)._cache = cache;
    (service as any)._userDB = userDB;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('returns the legacy email prefix for an un-migrated user (flag=false)', async () => {
    cache.getObject.mockResolvedValue(null);
    userDB.getStorageConfig.mockResolvedValue({
      external_id: EXTERNAL_ID,
      storage_uses_external_id: false,
    });

    expect(await service.getPrefix(makeUser())).toBe(RELAY);
  });

  it('returns external_id for a migrated user (flag=true)', async () => {
    cache.getObject.mockResolvedValue(null);
    userDB.getStorageConfig.mockResolvedValue({
      external_id: EXTERNAL_ID,
      storage_uses_external_id: true,
    });

    expect(await service.getPrefix(makeUser())).toBe(EXTERNAL_ID);
  });

  it('caches the resolved config on a miss', async () => {
    cache.getObject.mockResolvedValue(null);
    userDB.getStorageConfig.mockResolvedValue({
      external_id: EXTERNAL_ID,
      storage_uses_external_id: true,
    });

    await service.getPrefix(makeUser());

    expect(cache.setObject).toHaveBeenCalledWith(
      'storage_prefix_cfg_67662',
      { usesExternalId: true, externalId: EXTERNAL_ID },
      3600,
    );
  });

  it('uses a cache hit without touching the DB', async () => {
    cache.getObject.mockResolvedValue({
      usesExternalId: true,
      externalId: EXTERNAL_ID,
    });

    expect(await service.getPrefix(makeUser())).toBe(EXTERNAL_ID);
    expect(userDB.getStorageConfig).not.toHaveBeenCalled();
  });

  it('fails safe to email when flag=true but external_id is missing', async () => {
    cache.getObject.mockResolvedValue(null);
    userDB.getStorageConfig.mockResolvedValue({
      external_id: null,
      storage_uses_external_id: true,
    });

    expect(await service.getPrefix(makeUser({ external_id: undefined }))).toBe(
      RELAY,
    );
    expect(mockLoggerService.log).toHaveBeenCalled();
  });

  it('fails safe to email when external_id contains a slash', async () => {
    cache.getObject.mockResolvedValue({
      usesExternalId: true,
      externalId: 'evil/prefix',
    });

    expect(await service.getPrefix(makeUser())).toBe(RELAY);
    expect(mockLoggerService.log).toHaveBeenCalled();
  });

  it('falls back to email when the DB row is missing', async () => {
    cache.getObject.mockResolvedValue(null);
    userDB.getStorageConfig.mockResolvedValue(null);

    expect(await service.getPrefix(makeUser())).toBe(RELAY);
  });

  it('does NOT cache a null DB read (avoids poisoning the cache on a transient error)', async () => {
    cache.getObject.mockResolvedValue(null);
    userDB.getStorageConfig.mockResolvedValue(null);

    await service.getPrefix(makeUser());

    // No fallback config persisted, so the next request re-reads the DB once it recovers.
    expect(cache.setObject).not.toHaveBeenCalled();
  });

  it('falls back to email on cache/DB error', async () => {
    cache.getObject.mockRejectedValue(new Error('valkey down'));

    expect(await service.getPrefix(makeUser())).toBe(RELAY);
  });

  it('returns email without a lookup when id_user is absent', async () => {
    expect(await service.getPrefix({ email: 'x@y.com' } as any)).toBe('x@y.com');
    expect(cache.getObject).not.toHaveBeenCalled();
  });

  it('throws (never returns undefined) when the user has no email', async () => {
    await expect(service.getPrefix({ id_user: 1 } as any)).rejects.toThrow();
    await expect(service.getPrefix(undefined as any)).rejects.toThrow();
    expect(cache.getObject).not.toHaveBeenCalled();
  });

  it('invalidate() deletes the cached config', async () => {
    await service.invalidate(67662);
    expect(cache.deleteObject).toHaveBeenCalledWith('storage_prefix_cfg_67662');
  });
});
