import { RestClientService } from './RestClientService';
import { RedisService } from './RedisService';
import { logger } from './LoggerService';

export type RCActiveStatus = {
  active: boolean;
  expiresMs: number | null;
  // Tier lookup keys (`pro`/`plus`/`lite`), translated from RC's internal
  // entitlement object ids so they match webhooks and SubscriptionTierEnum.
  entitlementIds: string[];
};

type RCEntitlement = {
  entitlement_id?: string;
  expires_at?: number | null;
};

type RCCustomerResponse = {
  // v2's customer endpoint only ever returns the server-computed active set
  // (refunded/revoked/expired entitlements are already excluded by RC).
  active_entitlements?: { items?: RCEntitlement[] };
};

type RCProjectEntitlement = {
  id?: string;
  lookup_key?: string;
};

type RCEntitlementsResponse = {
  items?: RCProjectEntitlement[];
};

// RC's internal entitlement ids are stable per project, so the id->lookup_key
// map is cached for a day; an unknown id forces a single refresh (self-heal for
// a newly-added entitlement) before it's dropped.
const ENTITLEMENT_MAP_CACHE_KEY = 'rc:entitlement_map';
const ENTITLEMENT_MAP_TTL = 24 * 60 * 60;

export class RevenueCatV2Client {
  private readonly _logger = logger;

  constructor(
    private _restClient: RestClientService = new RestClientService(),
    private _cache: RedisService = new RedisService(),
  ) {}

  async fetchActiveStatus(externalId: string): Promise<RCActiveStatus> {
    try {
      const data = (await this._restClient.callService({
        baseURL: process.env.REVENUECAT_API_V2,
        service: `projects/${process.env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(externalId)}`,
        method: 'get',
        headers: {
          authorization: `Bearer ${process.env.REVENUECAT_API_V2_KEY}`,
        },
        timeout: 2000,
      })) as RCCustomerResponse;

      const items = data?.active_entitlements?.items ?? [];

      // RC v2 returns `expires_at` as Unix milliseconds; tag the unit at the
      // boundary so all internal comparisons use a single, named scale.
      const now = Date.now();
      let active = false;
      let maxExpiresMs: number | null = null;
      const internalIds: string[] = [];
      // Lifetime grants (`expires_at === null`) anchor `maxExpiresMs` at null
      // (maximally active), but we must keep iterating so every active
      // entitlement is collected — these feed `requireSubscription`, so an
      // early `break` would drop later tiers (e.g. a separate `pro` grant).
      let hasLifetime = false;
      for (const ent of items) {
        const expiresMs: number | null = ent.expires_at ?? null;
        if (expiresMs === null) {
          active = true;
          hasLifetime = true;
          if (ent.entitlement_id) {
            internalIds.push(ent.entitlement_id);
          }
          continue;
        }
        if (expiresMs > now) {
          active = true;
          if (ent.entitlement_id) {
            internalIds.push(ent.entitlement_id);
          }
          if (!hasLifetime && (maxExpiresMs === null || expiresMs > maxExpiresMs)) {
            maxExpiresMs = expiresMs;
          }
        }
      }
      if (hasLifetime) {
        maxExpiresMs = null;
      }

      const entitlementIds = await this._toLookupKeys(internalIds);
      return { active, expiresMs: maxExpiresMs, entitlementIds };
    } catch (err) {
      this._logger.log({
        origin: 'RevenueCatV2Client.fetchActiveStatus',
        message: err.message,
        data: { externalId },
      }, 'warn');
      throw err;
    }
  }

  // Translate RC's internal entitlement object ids (e.g. `entla0aca3f4af`) into
  // tier lookup keys (`pro`/`plus`/`lite`) so the RC path agrees with the
  // webhook path and SubscriptionTierEnum. Unknown ids trigger one cache
  // refresh, then are dropped (with a warning) rather than leaking a raw id.
  private async _toLookupKeys(internalIds: string[]): Promise<string[]> {
    if (internalIds.length === 0) return [];

    let map = await this._getEntitlementMap();
    if (internalIds.some((id) => !(id in map))) {
      const refreshed = await this._getEntitlementMap(true);
      // Keep the previous map if the refresh failed (endpoint unreachable).
      if (Object.keys(refreshed).length > 0) {
        map = refreshed;
      }
    }

    const keys: string[] = [];
    for (const id of internalIds) {
      const lookupKey = map[id];
      if (lookupKey) {
        keys.push(lookupKey);
      } else {
        this._logger.log({
          origin: 'RevenueCatV2Client._toLookupKeys',
          message: `Unknown RC entitlement id, dropped from tiers: ${id}`,
        }, 'warn');
      }
    }
    return keys;
  }

  private async _getEntitlementMap(
    forceRefresh = false,
  ): Promise<Record<string, string>> {
    if (!forceRefresh) {
      const cached = (await this._cache.getObject(
        ENTITLEMENT_MAP_CACHE_KEY,
      )) as Record<string, string> | null;
      if (cached) return cached;
    }

    try {
      const data = (await this._restClient.callService({
        baseURL: process.env.REVENUECAT_API_V2,
        service: `projects/${process.env.REVENUECAT_PROJECT_ID}/entitlements`,
        method: 'get',
        headers: {
          authorization: `Bearer ${process.env.REVENUECAT_API_V2_KEY}`,
        },
        timeout: 2000,
      })) as RCEntitlementsResponse;

      const map: Record<string, string> = {};
      for (const ent of data?.items ?? []) {
        if (ent.id && ent.lookup_key) {
          map[ent.id] = ent.lookup_key;
        }
      }
      if (Object.keys(map).length > 0) {
        await this._cache.setObject(
          ENTITLEMENT_MAP_CACHE_KEY,
          map,
          ENTITLEMENT_MAP_TTL,
        );
      }
      return map;
    } catch (err) {
      this._logger.log({
        origin: 'RevenueCatV2Client._getEntitlementMap',
        message: err.message,
      }, 'warn');
      return {};
    }
  }
}
