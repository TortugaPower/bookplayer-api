import {AppleUser, RevenuecatEvent } from "../types/user";

export interface ISubscriptionService {
  ParseNewEvent(event: RevenuecatEvent): Promise<AppleUser>;
  GetAndUpdateSubscription( user: AppleUser ): Promise<boolean>;
}
