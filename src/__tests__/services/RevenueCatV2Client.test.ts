import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { RevenueCatV2Client } from '../../services/RevenueCatV2Client';
import { mockLoggerService } from '../setup';

// The id->tier map is supplied via env (REVENUECAT_ENTITLEMENT_*). Set known
// ids so the customer payload's internal ids translate to lookup keys.
const ENV = {
  REVENUECAT_ENTITLEMENT_PRO: 'entla0aca3f4af',
  REVENUECAT_ENTITLEMENT_PLUS: 'entlb697e08b61',
  REVENUECAT_ENTITLEMENT_LITE: 'entl3df01b68f9',
  REVENUECAT_PROJECT_ID: 'proj_test',
  REVENUECAT_API_V2_KEY: 'sk_test',
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

  // What axios rejects with for an HTTP error response.
  const httpError = (status: number, data: object) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data },
    });

  it('a customer RC has never seen (404 resource_missing) has no entitlements', async () => {
    const { client } = makeClient();
    (client as any)._restClient.callService = jest.fn(async () => {
      throw httpError(404, { object: 'error', type: 'resource_missing' });
    });

    await expect(client.fetchActiveStatus('ext-new')).resolves.toEqual({
      active: false,
      expiresMs: null,
      entitlementIds: [],
    });
  });

  it('any other failure still throws, so callers fail closed', async () => {
    const { client } = makeClient();
    (client as any)._restClient.callService = jest.fn(async () => {
      throw httpError(401, { object: 'error', type: 'authentication_error' });
    });

    await expect(client.fetchActiveStatus('ext-1')).rejects.toThrow('401');
  });

  it('refuses without asking RC when the project or key is unset (its 404 would read as "no customer")', async () => {
    const { client, callService } = makeClient();
    delete process.env.REVENUECAT_PROJECT_ID;

    await expect(client.fetchActiveStatus('ext-1')).rejects.toThrow(
      'REVENUECAT_PROJECT_ID',
    );
    expect(callService).not.toHaveBeenCalled();
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
