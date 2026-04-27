import { RestClientService } from './RestClientService';
import { logger } from './LoggerService';

export type RCActiveStatus = {
  active: boolean;
  expiresMs: number | null;
};

type RCEntitlement = {
  lookup_key?: string;
  expires_at?: number | null;
};

type RCCustomerResponse = {
  active_entitlements?: { items?: RCEntitlement[] };
  entitlements?: { items?: RCEntitlement[] };
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

      const items =
        data?.active_entitlements?.items ?? data?.entitlements?.items ?? [];

      // RC v2 returns `expires_at` as Unix milliseconds; tag the unit at the
      // boundary so all internal comparisons use a single, named scale.
      const now = Date.now();
      let active = false;
      let maxExpiresMs: number | null = null;
      for (const ent of items) {
        const expiresMs: number | null = ent.expires_at ?? null;
        if (expiresMs === null) {
          active = true;
          maxExpiresMs = null;
          break;
        }
        if (expiresMs > now) {
          active = true;
          if (maxExpiresMs === null || expiresMs > maxExpiresMs) {
            maxExpiresMs = expiresMs;
          }
        }
      }

      return { active, expiresMs: maxExpiresMs };
    } catch (err) {
      this._logger.log({
        origin: 'RevenueCatV2Client.fetchActiveStatus',
        message: err.message,
        data: { externalId },
      }, 'warn');
      throw err;
    }
  }
}
