import { IRequest, IResponse, INext } from '../../types/http';
import { UserServices } from '../../services/UserServices';
import { SubscriptionEventType } from '../../types/user';

const userService = new UserServices();

export const checkSubscription = async (
  req: IRequest,
  res: IResponse,
  next: INext,
): Promise<void> => {
  try {
    const user = req.user;
    if (user) {
      const state = await userService.getUserSubscriptionState(user.id_user);
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
};
