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
  controller.InitLogin(req, res).catch(next),
);
UserRouter.get('/logout', (req, res, next) =>
  controller.Logout(req, res).catch(next),
);
UserRouter.post('/second_onboarding', (req, res, next) =>
  controller.secondOnboarding(req, res).catch(next),
);
UserRouter.post('/events', (req, res, next) =>
  controller.userEventsHandler(req, res).catch(next),
);
UserRouter.post('/revenuecat', (req, res, next) =>
  subscription.RevenuecatWebhook(req, res).catch(next),
);
UserRouter.delete('/delete', (req, res, next) =>
  controller.DeleteAccount(req, res).catch(next),
);

export default UserRouter;
