import { SubscriptionUser, RevenuecatEvent } from '../types/user';
import { RestClientService } from './RestClientService';
import { UserServices } from './UserServices';
import { logger } from './LoggerService';
import { EmailService } from './EmailService';
import { SubscriptionDB } from './db/SubscriptionDB';

export class SubscriptionService {
  private readonly _logger = logger;

  constructor(
    private _subscriptionDB: SubscriptionDB = new SubscriptionDB(),
    private _restClient: RestClientService = new RestClientService(),
    private _user: UserServices = new UserServices(),
    private _email: EmailService = new EmailService(),
  ) {}

  async parseNewEvent(event: RevenuecatEvent): Promise<SubscriptionUser> {
    try {
      const { original_app_user_id, aliases } = event;
      await this._subscriptionDB.insertSubscriptionEvent(event);
      const user = await this._user.getUserByExternalId(
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

  async getAndUpdateSubscription(user: SubscriptionUser): Promise<boolean> {
    try {
      const { external_id } = user;
      const { subscriber } = await this._restClient.callService({
        baseURL: process.env.REVENUECAT_API,
        service: `subscribers/${external_id}`,
        method: 'get',
        headers: { authorization: `Bearer ${process.env.REVENUECAT_KEY}` },
      });
      if (subscriber) {
        const subscriptions = Object.keys(subscriber.subscriptions);
        const subs = subscriptions.length ? subscriptions.join(',') : null;
        await this._user.updateSubscription(user.id_user, subs);
      }
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionService.getAndUpdateSubscription',
        message: err.message,
        data: { user },
      });
      return false;
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
}

interface SubscriptionParams {
  refunded_at?: string;
}
