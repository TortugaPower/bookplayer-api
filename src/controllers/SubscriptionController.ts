import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IUserService } from '../interfaces/IUserService';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { ISubscriptionController } from '../interfaces/ISubscriptionController';
import { RevenuecatEvent } from '../types/user';
import { ISubscriptionService } from '../interfaces/ISubscriptionService';


@injectable()
export class SubscriptionController implements ISubscriptionController {
  @inject(TYPES.SubscriptionService)
  private _subscriptionService: ISubscriptionService;

  public async RevenuecatWebhook(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const authorization = req.headers.authorization;
      if (!authorization || authorization !== process.env.REVENUECAT_HEADER) {
        res.status(400).json({ message: 'Invalid authorization' });
        return;
      }
      const { event } = req.body;
      const revenueEvent = event as RevenuecatEvent;
      const user = await this._subscriptionService.ParseNewEvent(revenueEvent);
      const updated = await this._subscriptionService.GetAndUpdateSubscription(user);
      return res.json({ success: updated });
    } catch(err) {
      res.status(400).json({ message: err.message });
      return;
    }
  }
}
