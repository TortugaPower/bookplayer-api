import { SubscriptionTier } from '../types/user';
import { INext, IRequest, IResponse } from './IRequest';

type MiddlewareHandler = (req: IRequest, res: IResponse, next: INext) => Promise<void> | void;

export interface ISubscriptionMiddleware {
  checkSubscription(req: IRequest, res: IResponse, _: INext): Promise<void>;
  requireSubscription(allowedTypes: SubscriptionTier[]): MiddlewareHandler;
}
