import express from 'express';
import { PasskeyController } from '../controllers/PasskeyController';
import { authRateLimiter, emailVerificationRateLimiter } from './middlewares/rateLimit';

const PasskeyRouter = express.Router();
const controller = new PasskeyController();

// Email verification endpoints (for new user registration)
PasskeyRouter.post('/verify-email/send', emailVerificationRateLimiter, (req, res, next) =>
  controller.sendVerificationCode(req, res, next).catch(next),
);
PasskeyRouter.post('/verify-email/check', authRateLimiter, (req, res, next) =>
  controller.checkVerificationCode(req, res, next).catch(next),
);

// Registration endpoints
PasskeyRouter.post('/register/options', authRateLimiter, (req, res, next) =>
  controller.registrationOptions(req, res, next).catch(next),
);
PasskeyRouter.post('/register/verify', authRateLimiter, (req, res, next) =>
  controller.registrationVerify(req, res, next).catch(next),
);

// Authentication endpoints
PasskeyRouter.post('/auth/options', authRateLimiter, (req, res, next) =>
  controller.authenticationOptions(req, res, next).catch(next),
);
PasskeyRouter.post('/auth/verify', authRateLimiter, (req, res, next) =>
  controller.authenticationVerify(req, res, next).catch(next),
);

// Credential management endpoints (require authentication)
PasskeyRouter.get('/credentials', (req, res, next) =>
  controller.listPasskeys(req, res, next).catch(next),
);
PasskeyRouter.delete('/credentials/:id', (req, res, next) =>
  controller.deletePasskey(req, res, next).catch(next),
);
PasskeyRouter.patch('/credentials/:id', (req, res, next) =>
  controller.renamePasskey(req, res, next).catch(next),
);

// Auth method management
PasskeyRouter.get('/auth-methods', (req, res, next) =>
  controller.listAuthMethods(req, res, next).catch(next),
);

export default PasskeyRouter;
