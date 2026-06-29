import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { RevenueCatV2Client } from '../../services/RevenueCatV2Client';
import { mockLoggerService } from '../setup';

// The id->tier map is supplied via env (REVENUECAT_ENTITLEMENT_*). Set known
// ids so the customer payload's internal ids translate to lookup keys.
const ENV = {
  REVENUECAT_ENTITLEMENT_PRO: 'entla0aca3f4af',
  REVENUECAT_ENTITLEMENT_PLUS: 'entlb697e08b61',
  REVENUECAT_ENTITLEMENT_LITE: 'entl3df01b68f9',
};
const ORIGINAL_ENV = { ...process.env };

const CUSTOMER_PRO_PLUS = {
  active_entitlements: {
    items: [
      { entitlement_id: 'entla0aca3f4af', expires_at: 8052666984088 }, // pro (lifetime promo)
      { entitlement_id: 'entlb697e08b61', expires_at: null }, // plus (true lifetime)
    ],
  },
};

function makeClient(customer: object = CUSTOMER_PRO_PLUS) {
  const callService = jest.fn(async () => customer);
  const client = new RevenueCatV2Client();
  (client as any)._restClient = { callService };
  (client as any)._logger = mockLoggerService;
  return { client, callService };
}

describe('RevenueCatV2Client.fetchActiveStatus', () => {
  beforeEach(() => {
    mockLoggerService.log.mockClear();
    Object.assign(process.env, ENV);
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('translates internal entitlement ids to tier lookup keys via env map', async () => {
    const { client, callService } = makeClient();
    const result = await client.fetchActiveStatus('ext-1');

    expect(result.active).toBe(true);
    expect(result.expiresMs).toBeNull(); // a lifetime grant present → maximally active
    expect(result.entitlementIds.sort()).toEqual(['plus', 'pro']);
    // No extra entitlements-map call — translation is from env only.
    expect(callService).toHaveBeenCalledTimes(1);
  });

  it('drops (and warns about) an id with no env mapping', async () => {
    const { client } = makeClient({
      active_entitlements: {
        items: [
          { entitlement_id: 'entla0aca3f4af', expires_at: null }, // pro
          { entitlement_id: 'entlUNMAPPED', expires_at: null }, // not in env
        ],
      },
    });

    const result = await client.fetchActiveStatus('ext-2');

    expect(result.entitlementIds).toEqual(['pro']);
    expect(mockLoggerService.log).toHaveBeenCalled();
  });

  it('drops a tier whose env var is unset at runtime (defensive)', async () => {
    delete process.env.REVENUECAT_ENTITLEMENT_LITE;
    const { client } = makeClient({
      active_entitlements: {
        items: [
          { entitlement_id: 'entla0aca3f4af', expires_at: null }, // pro
          { entitlement_id: 'entl3df01b68f9', expires_at: null }, // lite, but env unset
        ],
      },
    });

    const result = await client.fetchActiveStatus('ext-3');

    expect(result.entitlementIds).toEqual(['pro']);
  });

  it('stays active with no tiers when none of the active ids are mapped', async () => {
    delete process.env.REVENUECAT_ENTITLEMENT_PRO;
    delete process.env.REVENUECAT_ENTITLEMENT_PLUS;
    delete process.env.REVENUECAT_ENTITLEMENT_LITE;
    const { client } = makeClient();

    const result = await client.fetchActiveStatus('ext-4');

    expect(result.active).toBe(true); // active is independent of the tier map
    expect(result.entitlementIds).toEqual([]);
  });
});
