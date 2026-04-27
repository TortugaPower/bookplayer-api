import { IRequest, IResponse, INext } from '../../types/http';
import { SubscriptionService } from '../../services/SubscriptionService';
import { UserDB } from '../../services/db/UserDB';

const subscriptionService = new SubscriptionService();
const userDB = new UserDB();

export const checkSubscription = async (
  req: IRequest,
  res: IResponse,
  next: INext,
): Promise<void> => {
  try {
    const user = req.user;
    if (!user?.id_user) {
      return res.status(400).json({ message: 'the user is invalid' });
    }
    // Older Apple-login JWTs don't carry external_id; fall back to a DB lookup
    // for those. New Apple + passkey logins include it directly on the token.
    const externalId =
      user.external_id || (await userDB.getExternalIdByUserId(user.id_user));
    const active = await subscriptionService.isActive(externalId);
    if (!active) {
      return res.status(400).json({ message: 'You are not subscribed' });
    }
    next();
  } catch (error) {
    next(error);
  }
};
