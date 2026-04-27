import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { SubscriptionService } from '../../services/SubscriptionService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestSubscriptionEvent,
} from '../setup';

type CacheStore = Map<string, { value: string; expiresAt: number | null }>;

function makeCacheMock() {
  const store: CacheStore = new Map();
  const setObject = jest.fn(
    async (key: string, value: object, ttl?: number): Promise<string> => {
      const expiresAt = ttl && ttl > 0 ? Date.now() + ttl * 1000 : null;
      store.set(key, { value: JSON.stringify(value), expiresAt });
      return 'OK';
    },
  );
  const getObject = jest.fn(async (key: string): Promise<object | null> => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return JSON.parse(entry.value);
  });
  const deleteObject = jest.fn(async (key: string): Promise<boolean> => {
    return store.delete(key);
  });
  return { setObject, getObject, deleteObject, store };
}

function makeRcMock(result: { active: boolean; expiresMs: number | null }) {
  return {
    fetchActiveStatus: jest.fn<() => Promise<{ active: boolean; expiresMs: number | null }>>()
      .mockResolvedValue(result),
  };
}

function makeRcThrowingMock(message = 'timeout') {
  return {
    fetchActiveStatus: jest.fn<() => Promise<never>>()
      .mockRejectedValue(new Error(message)),
  };
}

describe('SubscriptionService.isActive', () => {
  let service: SubscriptionService;
  let cache: ReturnType<typeof makeCacheMock>;

  beforeEach(() => {
    delete process.env.SUBSCRIPTION_CACHE_ENABLED;
    service = new SubscriptionService();
    (service as any)._logger = mockLoggerService;
    (service as any)._subscriptionDB.db = getTestTransaction();
    (service as any)._subscriptionDB._logger = mockLoggerService;
    (service as any)._userDB.db = getTestTransaction();
    (service as any)._userDB._logger = mockLoggerService;

    cache = makeCacheMock();
    (service as any)._cache = cache;
    mockLoggerService.log.mockClear();
  });

  it('returns true on positive cache hit without DB or RC calls', async () => {
    const externalId = randomUUID();
    await cache.setObject(`sub:${externalId}`, { active: true, verified: 'rc' }, 3600);
    const rcMock = makeRcMock({ active: false, expiresMs: null });
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    expect(result).toBe(true);
    expect(rcMock.fetchActiveStatus).not.toHaveBeenCalled();
  });

  it('returns false on RC-verified negative cache hit without RC call', async () => {
    const externalId = randomUUID();
    await cache.setObject(`sub:${externalId}`, { active: false, verified: 'rc' }, 1800);
    const rcMock = makeRcMock({ active: false, expiresMs: null });
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    expect(result).toBe(false);
    expect(rcMock.fetchActiveStatus).not.toHaveBeenCalled();
  });

  it('returns true when local DB has active RENEWAL with expiration in the future', async () => {
    const trx = getTestTransaction();
    const externalId = randomUUID();
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'RENEWAL',
      expiration_at_ms: Date.now() + 5 * 86_400_000,
    });
    // Mock RC v2 so the canary path (5%) doesn't actually fire a network call.
    (service as any)._rcV2 = makeRcMock({ active: true, expiresMs: null });

    const result = await service.isActive(externalId);

    expect(result).toBe(true);
    const cached = JSON.parse(cache.store.get(`sub:${externalId}`)!.value);
    expect(cached).toEqual({ active: true, verified: 'local' });
  });

  it('returns false when last event is EXPIRATION and falls through to RC', async () => {
    const trx = getTestTransaction();
    const externalId = randomUUID();
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'EXPIRATION',
      expiration_at_ms: Date.now() - 86_400_000,
    });
    const rcMock = makeRcMock({ active: false, expiresMs: null });
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    expect(result).toBe(false);
    expect(rcMock.fetchActiveStatus).toHaveBeenCalledWith(externalId);
    const cached = JSON.parse(cache.store.get(`sub:${externalId}`)!.value);
    expect(cached).toEqual({ active: false, verified: 'rc' });
  });

  it('stale-revalidate: local says inactive (expired RENEWAL), RC says active → return true', async () => {
    const trx = getTestTransaction();
    const externalId = randomUUID();
    // RENEWAL event whose period already ended (no follow-up EXPIRATION webhook arrived)
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'RENEWAL',
      expiration_at_ms: Date.now() - 1000,
    });
    const rcMock = makeRcMock({
      active: true,
      expiresMs: Date.now() + 5 * 86_400_000,
    });
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    expect(result).toBe(true);
    expect(rcMock.fetchActiveStatus).toHaveBeenCalledWith(externalId);
    const cached = JSON.parse(cache.store.get(`sub:${externalId}`)!.value);
    expect(cached).toEqual({ active: true, verified: 'rc' });
  });

  it('returns false and does NOT cache when RC times out', async () => {
    const externalId = randomUUID();
    const rcMock = makeRcThrowingMock('ECONNABORTED');
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    expect(result).toBe(false);
    expect(cache.store.has(`sub:${externalId}`)).toBe(false);
  });

  it('orders by event_timestamp_ms, not insertion id', async () => {
    const trx = getTestTransaction();
    const externalId = randomUUID();
    // Insert id-later but event-earlier:
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'RENEWAL',
      expiration_at_ms: Date.now() + 30 * 86_400_000,
      event_timestamp_ms: Date.now() - 60_000,
    });
    // Insert id-later AND event-later → this is the truly-latest:
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'EXPIRATION',
      expiration_at_ms: Date.now() - 1000,
      event_timestamp_ms: Date.now(),
    });
    const rcMock = makeRcMock({ active: false, expiresMs: null });
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    // Latest event by timestamp is EXPIRATION → local says inactive → RC says inactive
    expect(result).toBe(false);
    expect(rcMock.fetchActiveStatus).toHaveBeenCalled();
  });

  it('coalesces concurrent calls for the same externalId', async () => {
    const trx = getTestTransaction();
    const externalId = randomUUID();
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'RENEWAL',
      expiration_at_ms: Date.now() + 5 * 86_400_000,
    });
    (service as any)._rcV2 = makeRcMock({ active: true, expiresMs: null });

    const [a, b, c] = await Promise.all([
      service.isActive(externalId),
      service.isActive(externalId),
      service.isActive(externalId),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
    expect(cache.setObject).toHaveBeenCalledTimes(1);
  });

  it('matches user via aliases JSON path', async () => {
    const trx = getTestTransaction();
    const aliasId = randomUUID();
    const primaryId = randomUUID();
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: primaryId,
      type: 'RENEWAL',
      expiration_at_ms: Date.now() + 5 * 86_400_000,
      aliases: [aliasId],
    });
    (service as any)._rcV2 = makeRcMock({ active: true, expiresMs: null });

    const result = await service.isActive(aliasId);

    expect(result).toBe(true);
  });

  it('SUBSCRIPTION_CACHE_ENABLED=false bypasses cache and RC fallback', async () => {
    process.env.SUBSCRIPTION_CACHE_ENABLED = 'false';
    const trx = getTestTransaction();
    const externalId = randomUUID();
    await createTestSubscriptionEvent(trx, {
      original_app_user_id: externalId,
      type: 'RENEWAL',
      expiration_at_ms: Date.now() + 86_400_000,
    });
    const rcMock = makeRcMock({ active: false, expiresMs: null });
    (service as any)._rcV2 = rcMock;

    const result = await service.isActive(externalId);

    expect(result).toBe(true);
    expect(cache.setObject).not.toHaveBeenCalled();
    expect(rcMock.fetchActiveStatus).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.invalidateCache', () => {
  it('deletes the cache entry', async () => {
    const service = new SubscriptionService();
    const cache = makeCacheMock();
    (service as any)._cache = cache;
    const externalId = randomUUID();
    await cache.setObject(`sub:${externalId}`, { active: true, verified: 'rc' }, 3600);

    await service.invalidateCache(externalId);

    expect(cache.deleteObject).toHaveBeenCalledWith(`sub:${externalId}`);
    expect(cache.store.has(`sub:${externalId}`)).toBe(false);
  });

  it('is a no-op for empty externalId', async () => {
    const service = new SubscriptionService();
    const cache = makeCacheMock();
    (service as any)._cache = cache;

    await service.invalidateCache('');

    expect(cache.deleteObject).not.toHaveBeenCalled();
  });
});
