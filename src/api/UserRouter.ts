import express from 'express';
import { UserController } from '../controllers/UserController';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { authRateLimiter } from './middlewares/rateLimit';

const UserRouter = express.Router();
const controller = new UserController();
const subscription = new SubscriptionController();

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

export default UserRouter;
