import { SubscriptionUser, RevenuecatEvent } from '../types/user';

export interface ISubscriptionService {
  ParseNewEvent(event: RevenuecatEvent): Promise<SubscriptionUser>;
  GetAndUpdateSubscription(user: SubscriptionUser): Promise<boolean>;
  HasInAppPurchase(rc_id: string): Promise<boolean>;
}
