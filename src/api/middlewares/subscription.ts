import { IRequest, IResponse, INext } from '../../types/http';
import { SubscriptionService } from '../../services/SubscriptionService';
import { UserDB } from '../../services/db/UserDB';
import { SubscriptionTier } from '../../types/user';

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
    const externalId = user.external_id || (await userDB.getExternalIdByUserId(user.id_user));
    const active = await subscriptionService.isActive(externalId);
    if (!active) {
      return res.status(400).json({ message: 'You are not subscribed' });
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireSubscription = (allowedTypes: SubscriptionTier[]) => {
  return async (req: IRequest, res: IResponse, next: INext): Promise<void> => {
    
    if (!req.user) {
      res.status(400).json({ error: "User data missing." });
      return;
    }
    if (allowedTypes.includes(req.user.subscriptions[0])) {
      next();
    } else {
      res.status(403).json({ 
        error: `Requires one of: ${allowedTypes.join(', ')}` 
      });
    }
  };
}
