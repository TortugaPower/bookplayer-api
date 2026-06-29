import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RevenueCatV2Client } from '../../services/RevenueCatV2Client';
import { mockLoggerService } from '../setup';

// Simulates RC's two endpoints: the customer (returns internal entitlement ids)
// and the project entitlements list (the id -> lookup_key map).
const CUSTOMER_PRO_PLUS = {
  active_entitlements: {
    items: [
      { entitlement_id: 'entla0aca3f4af', expires_at: 8052666984088 }, // pro (lifetime promo)
      { entitlement_id: 'entlb697e08b61', expires_at: null }, // plus (true lifetime)
    ],
  },
};

const ENTITLEMENTS_MAP = {
  items: [
    { id: 'entl3df01b68f9', lookup_key: 'lite' },
    { id: 'entla0aca3f4af', lookup_key: 'pro' },
    { id: 'entlb697e08b61', lookup_key: 'plus' },
  ],
};

function makeClient() {
  const callService = jest.fn(async (opts: any) => {
    if (String(opts.service).includes('/entitlements')) return ENTITLEMENTS_MAP;
    return CUSTOMER_PRO_PLUS;
  });
  const store = new Map<string, object>();
  const cache = {
    getObject: jest.fn(async (k: string) => store.get(k) ?? null),
    setObject: jest.fn(async (k: string, v: object) => {
      store.set(k, v);
      return 'OK';
    }),
    deleteObject: jest.fn(async (k: string) => store.delete(k)),
  };
  const client = new RevenueCatV2Client();
  (client as any)._restClient = { callService };
  (client as any)._cache = cache;
  (client as any)._logger = mockLoggerService;
  return { client, callService, cache, store };
}

describe('RevenueCatV2Client.fetchActiveStatus', () => {
  beforeEach(() => {
    mockLoggerService.log.mockClear();
  });

  it('translates internal entitlement ids to tier lookup keys', async () => {
    const { client } = makeClient();
    const result = await client.fetchActiveStatus('ext-1');

    expect(result.active).toBe(true);
    expect(result.expiresMs).toBeNull(); // a lifetime grant present → maximally active
    expect(result.entitlementIds.sort()).toEqual(['plus', 'pro']);
  });

  it('caches the entitlement map: a second call does not refetch it', async () => {
    const { client, callService } = makeClient();
    await client.fetchActiveStatus('ext-1');
    await client.fetchActiveStatus('ext-1');

    const mapCalls = callService.mock.calls.filter((c: any) =>
      String(c[0].service).includes('/entitlements'),
    );
    expect(mapCalls).toHaveLength(1); // fetched once, served from cache after
  });

  it('refreshes the map once when an unknown id appears, then drops it if still unknown', async () => {
    const { client, callService } = makeClient();
    // Customer has an id not present in the (stale) map.
    callService.mockImplementation(async (opts: any) => {
      if (String(opts.service).includes('/entitlements')) {
        return { items: [{ id: 'entla0aca3f4af', lookup_key: 'pro' }] }; // missing the new id
      }
      return {
        active_entitlements: {
          items: [
            { entitlement_id: 'entla0aca3f4af', expires_at: null },
            { entitlement_id: 'entlNEW999', expires_at: null },
          ],
        },
      };
    });

    const result = await client.fetchActiveStatus('ext-2');

    expect(result.entitlementIds).toEqual(['pro']); // unknown id dropped
    const mapCalls = callService.mock.calls.filter((c: any) =>
      String(c[0].service).includes('/entitlements'),
    );
    expect(mapCalls.length).toBeGreaterThanOrEqual(2); // initial + self-heal refresh
    expect(mockLoggerService.log).toHaveBeenCalled(); // warned about the unknown id
  });

  it('returns active with no tiers when the entitlement map is unavailable', async () => {
    const { client, callService } = makeClient();
    callService.mockImplementation(async (opts: any) => {
      if (String(opts.service).includes('/entitlements')) {
        throw new Error('map endpoint down');
      }
      return CUSTOMER_PRO_PLUS;
    });

    const result = await client.fetchActiveStatus('ext-3');

    expect(result.active).toBe(true); // active is computed from expires_at, independent of the map
    expect(result.entitlementIds).toEqual([]); // can't translate → dropped, never leaks raw ids
  });
});
