import { IRequest, IResponse, INext } from '../../types/http';
import { UserServices } from '../../services/UserServices';
import { SubscriptionEventType } from '../../types/user';

export class SubscriptionMiddleware {
  constructor(private _userService: UserServices = new UserServices()) {}
  async checkSubscription(
    req: IRequest,
    res: IResponse,
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
