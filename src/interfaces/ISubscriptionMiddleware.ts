import { INext, IRequest, IResponse } from './IRequest';

export interface ISubscriptionMiddleware {
  checkSubscription(req: IRequest, res: IResponse, _: INext): Promise<void>;
}
