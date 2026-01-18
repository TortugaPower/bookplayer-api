import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { PasskeyController } from '../controllers/PasskeyController';

@injectable()
export class PasskeyRouter {
  @inject(TYPES.PasskeyController) private _controller: PasskeyController;

  get(): express.Router {
    const router = express.Router();

    // Email verification endpoints (for new user registration)
    router.post('/verify-email/send', (req, res, next) =>
      this._controller.sendVerificationCode(req, res, next).catch(next),
    );
    router.post('/verify-email/check', (req, res, next) =>
      this._controller.checkVerificationCode(req, res, next).catch(next),
    );

    // Registration endpoints
    router.post('/register/options', (req, res, next) =>
      this._controller.registrationOptions(req, res, next).catch(next),
    );
    router.post('/register/verify', (req, res, next) =>
      this._controller.registrationVerify(req, res, next).catch(next),
    );

    // Authentication endpoints
    router.post('/auth/options', (req, res, next) =>
      this._controller.authenticationOptions(req, res, next).catch(next),
    );
    router.post('/auth/verify', (req, res, next) =>
      this._controller.authenticationVerify(req, res, next).catch(next),
    );

    // Credential management endpoints (require authentication)
    router.get('/credentials', (req, res, next) =>
      this._controller.listPasskeys(req, res, next).catch(next),
    );
    router.delete('/credentials/:id', (req, res, next) =>
      this._controller.deletePasskey(req, res, next).catch(next),
    );
    router.patch('/credentials/:id', (req, res, next) =>
      this._controller.renamePasskey(req, res, next).catch(next),
    );

    // Auth method management
    router.get('/auth-methods', (req, res, next) =>
      this._controller.listAuthMethods(req, res, next).catch(next),
    );

    return router;
  }
}
