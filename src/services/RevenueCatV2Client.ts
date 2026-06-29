import { RestClientService } from './RestClientService';
import { logger } from './LoggerService';
import { SubscriptionTierEnum } from '../types/user';

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

export class RevenueCatV2Client {
  private readonly _logger = logger;

  constructor(
    private _restClient: RestClientService = new RestClientService(),
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

      return { active, expiresMs: maxExpiresMs, entitlementIds: this._toLookupKeys(internalIds) };
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
  // webhook path and SubscriptionTierEnum. The id->tier map is supplied via env
  // (REVENUECAT_ENTITLEMENT_*) because RC's internal ids are stable per project.
  // An id with no mapping is dropped (with a warning) rather than leaking a raw
  // id into `subscriptions` — surfaces a missing/renamed entitlement in logs.
  private _toLookupKeys(internalIds: string[]): string[] {
    if (internalIds.length === 0) return [];
    const map = this._entitlementMap();
    const keys: string[] = [];
    for (const id of internalIds) {
      const lookupKey = map[id];
      if (lookupKey) {
        keys.push(lookupKey);
      } else {
        this._logger.log({
          origin: 'RevenueCatV2Client._toLookupKeys',
          message: `Unmapped RC entitlement id, dropped from tiers: ${id}`,
        }, 'warn');
      }
    }
    return keys;
  }

  private _entitlementMap(): Record<string, SubscriptionTierEnum> {
    const map: Record<string, SubscriptionTierEnum> = {};
    const pro = process.env.REVENUECAT_ENTITLEMENT_PRO;
    const plus = process.env.REVENUECAT_ENTITLEMENT_PLUS;
    const lite = process.env.REVENUECAT_ENTITLEMENT_LITE;
    if (pro) map[pro] = SubscriptionTierEnum.PRO;
    if (plus) map[plus] = SubscriptionTierEnum.PLUS;
    if (lite) map[lite] = SubscriptionTierEnum.LITE;
    return map;
  }
}
