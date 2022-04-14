
import { IRequest, IResponse, INext } from './IRequest';

export interface ISubscriptionController {
  RevenuecatWebhook(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
}
