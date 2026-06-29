import { SubscriptionUser, RevenuecatEvent, SubscriptionEventType, SubscriptionState } from '../types/user';
import { RestClientService } from './RestClientService';
import { logger } from './LoggerService';
import { EmailService } from './EmailService';
import { SubscriptionDB } from './db/SubscriptionDB';
import { UserDB } from './db/UserDB';
import { RedisService } from './RedisService';
import { RevenueCatV2Client } from './RevenueCatV2Client';

const POSITIVE_TTL_CAP = 30 * 86_400;       // 30 days
const POSITIVE_TTL_GRACE = 3600;            // 1 hour
const POSITIVE_TTL_FLOOR = 60;
const NEGATIVE_TTL = 1800;                  // 30 minutes (RC-verified)
const LIVE_RECHECK_TTL = 120;               // throttle for forced RC tier checks
const CANARY_PROBABILITY = 0.05;
const MISSING_SUB_STATE = {
  active: false,
  verified: 'local',
  subscriptions: []
} as SubscriptionState;

export class SubscriptionService {
  private readonly _logger = logger;
  private _inflight: Map<string, Promise<SubscriptionState>> = new Map();

  constructor(
    private _subscriptionDB: SubscriptionDB = new SubscriptionDB(),
    private _restClient: RestClientService = new RestClientService(),
    private _userDB: UserDB = new UserDB(),
    private _email: EmailService = new EmailService(),
    private _cache: RedisService = new RedisService(),
    private _rcV2: RevenueCatV2Client = new RevenueCatV2Client(),
  ) {}

  async parseNewEvent(event: RevenuecatEvent): Promise<SubscriptionUser | null> {
    try {
      const { original_app_user_id, aliases } = event;
      await this._subscriptionDB.insertSubscriptionEvent(event);
      const user = await this._userDB.getUserByExternalId(
        aliases || [original_app_user_id],
      );
      if (!user) {
        return null;
      }
      return user;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionService.parseNewEvent',
        message: err.message,
        data: { event },
      });
      return null;
    }
  }

  async isActive(externalId: string): Promise<SubscriptionState | null> {
    if (!externalId) return null;
    if (process.env.SUBSCRIPTION_CACHE_ENABLED === 'false') {
      return this._isActiveFromLocalDB(externalId);
    }

    const cacheKey = this._cacheKey(externalId);
    const cached = (await this._cache.getObject(cacheKey)) as SubscriptionState | null;
    if (cached) {
      // Local data can lag RC (alias merges, missed webhooks), so a local-only
      // negative isn't trustworthy — only RC-verified negatives are. Positives
      // are always trustworthy.
      if (cached.active || cached.verified === 'rc') return cached;
    }

    const existing = this._inflight.get(externalId);
    if (existing) return existing;

    const promise = this._resolveActive(externalId, cacheKey).finally(() => {
      this._inflight.delete(externalId);
    });
    this._inflight.set(externalId, promise);
    return promise;
  }

  async invalidateCache(externalId: string): Promise<void> {
    if (!externalId) return;
    await this._cache.deleteObject(this._cacheKey(externalId));
    // Also clear the forced-recheck throttle so a subscription change is picked
    // up immediately rather than waiting out LIVE_RECHECK_TTL.
    await this._cache.deleteObject(this._liveCheckKey(externalId));
  }

  // `v2` namespaces the cache after SubscriptionState gained `subscriptions`.
  // Without the bump, entries written before deploy would deserialize with
  // `subscriptions: undefined` (for up to the positive-TTL cap) and silently
  // fail PRO gating / drop presigned URLs.
  private _cacheKey(externalId: string): string {
    return `sub:v2:${externalId}`;
  }

  private _liveCheckKey(externalId: string): string {
    return `sub:v2:livecheck:${externalId}`;
  }

  // Force a live RevenueCat lookup, bypassing the local-DB/cache path, and
  // refresh the cache with the result. Used as a last-resort tier check before
  // denying a paid action: a user who just upgraded (e.g. lite → pro) may have
  // stale local data (pro webhook not yet processed), so we confirm against RC
  // before gating them out. Returns null if RC is unreachable.
  async fetchLiveEntitlements(externalId: string): Promise<SubscriptionState | null> {
    if (!externalId) return null;
    // Throttle forced lookups: this runs on the deny path of
    // `requireSubscription`, so an active-but-wrong-tier user (e.g. `plus`
    // hitting a PRO route) would otherwise trigger a live RC call on every
    // request. Reuse a recent live result for a short window to bound that.
    const throttleKey = this._liveCheckKey(externalId);
    const recent = (await this._cache.getObject(throttleKey)) as SubscriptionState | null;
    if (recent) return recent;
    try {
      const rc = await this._rcV2.fetchActiveStatus(externalId);
      const subState: SubscriptionState = {
        active: rc.active,
        verified: 'rc',
        subscriptions: rc.entitlementIds ?? [],
      };
      await this._cache.setObject(throttleKey, subState, LIVE_RECHECK_TTL);
      if (rc.active) {
        await this._cache.setObject(
          this._cacheKey(externalId),
          subState,
          this._positiveTTL(rc.expiresMs),
        );
      }
      return subState;
    } catch (err) {
      this._logger.log(
        {
          origin: 'SubscriptionService.fetchLiveEntitlements',
          message: err.message,
          data: { externalId },
        },
        'warn',
      );
      return null;
    }
  }

  async hasInAppPurchase(rc_id: string): Promise<boolean> {
    try {
      const { subscriber } = await this._restClient.callService({
        baseURL: process.env.REVENUECAT_API,
        service: `subscribers/${rc_id}`,
        method: 'get',
        headers: { authorization: `Bearer ${process.env.REVENUECAT_KEY}` },
      });

      let hasPurchase = false;
      if (subscriber) {
        const hasEntitlements = Object.keys(subscriber.entitlements).length > 0;
        const hasSubscriptions =
          Object.keys(subscriber.subscriptions).length > 0;
        // Check if user has refunded the subscription
        if (
          hasSubscriptions &&
          Object.keys(subscriber.subscriptions).length === 1 &&
          Object.keys(subscriber.entitlements).length === 1
        ) {
          hasPurchase =
            (Object.values(subscriber.subscriptions)[0] as SubscriptionParams)
              .refunded_at === null;
        } else {
          hasPurchase = hasEntitlements || hasSubscriptions;
        }
      }

      return hasPurchase;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionService.hasInAppPurchase',
        message: err.message,
        data: { rc_id },
      });
      return false;
    }
  }

  private async _resolveActive(
    externalId: string,
    cacheKey: string,
  ): Promise<SubscriptionState> {
    const localState = await this._isActiveFromLocalDB(externalId);
    if (localState.active) {
      const event = await this._subscriptionDB.getLatestActiveEvent(externalId);
      const expiresMs = event?.expiration_at_ms ? Number(event.expiration_at_ms) : null;
      const subscriptions = event?.entitlement_ids ?? [];
      const subState = {
        active: localState.active,
        verified: 'local',
        subscriptions: subscriptions ?? []
      } as SubscriptionState
      const ttlSec = this._positiveTTL(expiresMs);
      await this._cache.setObject(cacheKey, subState, ttlSec);
      this._maybeCanary(externalId, true);
      
      return subState;
    }

    // Local says inactive — verify against RC before gating.
    let rcActive = false;
    let rcExpiresMs: number | null = null;
    let rcReachable = false;
    let rcEntitlements: string[] | null = null;
    try {
      const rc = await this._rcV2.fetchActiveStatus(externalId);
      rcActive = rc.active;
      rcExpiresMs = rc.expiresMs;
      rcEntitlements = rc.entitlementIds;
      rcReachable = true;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionService.isActive',
        message: 'RC verification failed',
        data: { externalId, error: err.message },
      }, 'warn');
    }

    const subState = {
      active: rcActive,
      verified: 'rc',
      subscriptions: rcEntitlements ?? []
    } as SubscriptionState;

    if (rcActive) {
      const ttlSec = this._positiveTTL(rcExpiresMs);
      await this._cache.setObject(cacheKey, subState, ttlSec);
      return subState;
    }

    if (rcReachable) {
      // Confirmed inactive by RC — cache for 30 min.
      await this._cache.setObject(cacheKey, subState, NEGATIVE_TTL);
    }
    // RC unreachable: don't cache; next request retries verification.
    return subState;
  }

  private async _isActiveFromLocalDB(externalId: string): Promise<SubscriptionState> {
    const event = await this._subscriptionDB.getLatestActiveEvent(externalId);
    if (!event) return MISSING_SUB_STATE;
    if (event.type === SubscriptionEventType.EXPIRATION) return MISSING_SUB_STATE;
    // null expiration_at_ms = lifetime grant (e.g. NON_RENEWING_PURCHASE promo).
    const expiresMs = event.expiration_at_ms ? Number(event.expiration_at_ms) : null;

    return {
      active: (expiresMs === null || expiresMs > Date.now()) ? true : false,
      verified: 'local',
      subscriptions: event.entitlement_ids || []
    };
  }

  private _positiveTTL(expiresMs: number | null): number {
    if (expiresMs === null) return POSITIVE_TTL_CAP;
    const remaining = Math.floor((expiresMs - Date.now()) / 1000) - POSITIVE_TTL_GRACE;
    return Math.min(POSITIVE_TTL_CAP, Math.max(POSITIVE_TTL_FLOOR, remaining));
  }

  private _maybeCanary(externalId: string, localActive: boolean): void {
    if (Math.random() >= CANARY_PROBABILITY) return;
    this._rcV2.fetchActiveStatus(externalId)
      .then((rc) => {
        if (rc.active !== localActive) {
          this._logger.log({
            origin: 'SubscriptionService.canary',
            message: 'local DB diverges from RC',
            data: { externalId, localActive, rcActive: rc.active },
          }, 'warn');
        }
      })
      .catch(() => { /* canary failures are not actionable */ });
  }
}

interface SubscriptionParams {
  refunded_at?: string;
}
