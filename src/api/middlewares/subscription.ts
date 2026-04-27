import { IRequest, IResponse, INext } from '../../types/http';
import { SubscriptionService } from '../../services/SubscriptionService';

const subscriptionService = new SubscriptionService();

export const checkSubscription = async (
  req: IRequest,
  res: IResponse,
  next: INext,
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(400).json({ message: 'the user is invalid' });
    }
    const active = await subscriptionService.isActive(user.external_id);
    if (!active) {
      return res.status(400).json({ message: 'You are not subscribed' });
    }
    next();
  } catch (error) {
    next(error);
  }
};
