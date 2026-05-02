import express from 'express';
import { UserController } from '../controllers/UserController';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { UserPreferencesController } from '../controllers/UserPreferencesController';
import { authRateLimiter } from './middlewares/rateLimit';
import { checkSubscription } from './middlewares/subscription';

const UserRouter = express.Router();
const controller = new UserController();
const subscription = new SubscriptionController();
const preferences = new UserPreferencesController();

UserRouter.get('/', (req, res, next) =>
  controller.getAuth(req, res).catch(next),
);
UserRouter.post('/login', authRateLimiter, (req, res, next) =>
  controller.initLogin(req, res).catch(next),
);
UserRouter.get('/logout', (req, res, next) =>
  controller.logout(req, res).catch(next),
);
UserRouter.post('/second_onboarding', (req, res, next) =>
  controller.secondOnboarding(req, res).catch(next),
);
UserRouter.post('/events', (req, res, next) =>
  controller.userEventsHandler(req, res).catch(next),
);
UserRouter.post('/revenuecat', (req, res, next) =>
  subscription.revenuecatWebhook(req, res).catch(next),
);
UserRouter.delete('/delete', (req, res, next) =>
  controller.deleteAccount(req, res).catch(next),
);
UserRouter.get('/preferences', checkSubscription, (req, res, next) =>
  preferences.getPreferences(req, res).catch(next),
);
UserRouter.patch('/preferences', checkSubscription, (req, res, next) =>
  preferences.setPreferences(req, res).catch(next),
);
UserRouter.delete('/preferences', checkSubscription, (req, res, next) =>
  preferences.deletePreferences(req, res).catch(next),
);

export default UserRouter;
