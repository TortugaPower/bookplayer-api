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
    const subState = await subscriptionService.isActive(externalId);
    if (!subState?.active) {
      return res.status(400).json({ message: 'You are not subscribed' });
    }
    req.user.subscriptions = subState.subscriptions
    next();
  } catch (error) {
    next(error);
  }
};

export const requireSubscription = (allowedTypes: SubscriptionTier[]) => {
  return async (req: IRequest, res: IResponse, next: INext): Promise<void> => {
    if (!req.user) {
      res.status(400).json({ message: 'User data missing.' });
      return;
    }
    const hasTier = (subs?: SubscriptionTier[]) =>
      subs?.some((t: SubscriptionTier) => allowedTypes.includes(t));

    if (hasTier(req.user.subscriptions)) {
      next();
      return;
    }

    // Local/cached tiers don't satisfy the requirement, but they can lag a
    // recent upgrade (e.g. lite → pro before the pro webhook is processed).
    // Before denying a paid action, confirm the live entitlements with RC.
    const externalId =
      req.user.external_id ||
      (await userDB.getExternalIdByUserId(req.user.id_user));
    const live = await subscriptionService.fetchLiveEntitlements(externalId);
    if (live?.active && hasTier(live.subscriptions as SubscriptionTier[])) {
      req.user.subscriptions = live.subscriptions;
      next();
      return;
    }

    res.status(403).json({
      message: `Requires one of: ${allowedTypes.join(', ')}`,
    });
  };
};
