import { inject, injectable } from 'inversify';
import { IRequest, IResponse, INext } from '../../interfaces/IRequest';
import { ISubscriptionMiddleware } from '../../interfaces/ISubscriptionMiddleware';
import { TYPES } from '../../ContainerTypes';
import { IUserService } from '../../interfaces/IUserService';
import { SubscriptionEventType } from '../../types/user';

@injectable()
export class SubscriptionMiddleware implements ISubscriptionMiddleware {
  @inject(TYPES.UserServices) private _userService: IUserService;
  async checkSubscription(
    req: IResponse,
    res: IRequest,
    next: INext,
  ): Promise<void> {
    try {
      const user = req.user;
      if (user) {
        const state = await this._userService.getUserSubscriptionState(
          user.id_user,
        );
        if (!state || state === SubscriptionEventType.EXPIRATION) {
          return res.status(400).json({ message: 'You are not subscribed' });
        }
        next();
      } else {
        return res.status(400).json({ message: 'the user is invalid' });
      }
    } catch (error) {
      next(error);
    }
  }
}
