import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { PasskeyService } from '../services/PasskeyService';
import { IEmailVerificationService } from '../interfaces/IEmailVerificationService';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IRequest, IResponse, INext } from '../interfaces/IRequest';

@injectable()
export class PasskeyController {
  @inject(TYPES.PasskeyService)
  private _passkeyService: PasskeyService;

  @inject(TYPES.EmailVerificationService)
  private _emailVerificationService: IEmailVerificationService;

  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  // Email verification endpoints
  public async sendVerificationCode(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(422).json({ message: 'Email is required' });
      }

      // Basic email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(422).json({ message: 'Invalid email format' });
      }

      const result = await this._emailVerificationService.sendVerificationCode(
        email,
      );

      if (!result.success) {
        // Return 409 Conflict for existing email, 429 for rate limiting
        const status = result.error_code === 'EMAIL_ALREADY_REGISTERED' ? 409 : 429;
        return res.status(status).json({
          message: result.error,
          error: result.error_code,
        });
      }

      return res.json({
        success: true,
        expires_in: result.expires_in,
      });
    } catch (err) {
      this._logger.log({ origin: 'sendVerificationCode', message: err.message, data: { body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  public async checkVerificationCode(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(422).json({ message: 'Email and code are required' });
      }

      const result = await this._emailVerificationService.verifyCode(
        email,
        code,
      );

      if (!result.verified) {
        return res.status(400).json({
          verified: false,
          message: result.error,
        });
      }

      return res.json({
        verified: true,
        verification_token: result.verification_token,
      });
    } catch (err) {
      this._logger.log({ origin: 'checkVerificationCode', message: err.message, data: { body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  // Registration endpoints
  public async registrationOptions(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const { email, device_name, verification_token } = req.body;
      const user = req.user;

      if (!email && !user) {
        return res.status(422).json({ message: 'Email is required' });
      }

      // For unauthenticated users (new registration), require email verification
      if (!user) {
        if (!verification_token) {
          return res.status(422).json({
            message:
              'Email verification required. Please verify your email first.',
          });
        }

        // Validate the verification token
        const tokenValidation =
          await this._emailVerificationService.validateVerificationToken(
            verification_token,
          );

        if (!tokenValidation.valid) {
          return res.status(401).json({ message: tokenValidation.error });
        }

        // Ensure the email in the token matches the request
        if (tokenValidation.email?.toLowerCase() !== email?.toLowerCase()) {
          return res.status(401).json({
            message: 'Verification token does not match the provided email',
          });
        }
      }

      const options = await this._passkeyService.generateRegistrationOptions({
        email: email || user?.email,
        user_id: user?.id_user,
        device_name,
      });

      return res.json(options);
    } catch (err) {
      this._logger.log({ origin: 'registrationOptions', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  public async registrationVerify(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const {
        email,
        credential_id,
        response: attestationResponse,
        device_name,
      } = req.body;
      const user = req.user;

      if (!email && !user) {
        return res.status(422).json({ message: 'Email is required' });
      }

      if (!credential_id || !attestationResponse) {
        return res
          .status(422)
          .json({ message: 'Credential ID and response are required' });
      }

      const result = await this._passkeyService.verifyRegistration({
        email: email || user?.email,
        credential_id,
        attestation_object: attestationResponse.attestation_object,
        client_data_json: attestationResponse.client_data_json,
        transports: attestationResponse.transports,
        device_name,
        user_id: user?.id_user,
      });

      if (!result.verified) {
        return res
          .status(400)
          .json({ message: 'Registration verification failed' });
      }

      // Get RevenueCat ID (Apple ID if user has one, otherwise public_id)
      const revenuecatId = await this._passkeyService.getRevenueCatId(
        result.user.id_user,
        result.user.public_id,
      );
      const hasSubscription = await this._passkeyService.hasSubscription(
        result.user.id_user,
      );

      return res.json({
        email: result.user.email,
        token: result.token,
        public_id: result.user.public_id,
        revenuecat_id: revenuecatId,
        has_subscription: hasSubscription,
      });
    } catch (err) {
      if (err.message.includes('Challenge not found')) {
        return res
          .status(422)
          .json({ message: 'Challenge expired or invalid' });
      }
      this._logger.log({ origin: 'registrationVerify', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  // Authentication endpoints
  public async authenticationOptions(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const { email } = req.body;

      const options = await this._passkeyService.generateAuthenticationOptions({
        email,
      });

      return res.json(options);
    } catch (err) {
      this._logger.log({ origin: 'authenticationOptions', message: err.message, data: { body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  public async authenticationVerify(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const { credential_id, response: assertionResponse } = req.body;

      if (!credential_id || !assertionResponse) {
        return res
          .status(422)
          .json({ message: 'Credential ID and response are required' });
      }

      const result = await this._passkeyService.verifyAuthentication({
        credential_id,
        authenticator_data: assertionResponse.authenticator_data,
        client_data_json: assertionResponse.client_data_json,
        signature: assertionResponse.signature,
        user_handle: assertionResponse.user_handle,
      });

      if (!result.verified) {
        return res.status(401).json({ message: 'Authentication failed' });
      }

      // Get RevenueCat ID (Apple ID if user has one, otherwise public_id)
      const revenuecatId = await this._passkeyService.getRevenueCatId(
        result.user.id_user,
        result.user.public_id,
      );
      const hasSubscription = await this._passkeyService.hasSubscription(
        result.user.id_user,
      );

      return res.json({
        email: result.user.email,
        token: result.token,
        public_id: result.user.public_id,
        revenuecat_id: revenuecatId,
        has_subscription: hasSubscription,
      });
    } catch (err) {
      if (err.message.includes('Challenge not found')) {
        return res
          .status(422)
          .json({ message: 'Challenge expired or invalid' });
      }
      if (err.message.includes('Credential not found')) {
        return res.status(404).json({ message: 'Passkey not found' });
      }
      this._logger.log({ origin: 'authenticationVerify', message: err.message, data: { body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  // Credential management endpoints
  public async listPasskeys(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const passkeys = await this._passkeyService.getUserPasskeys(user.id_user);

      return res.json({ passkeys });
    } catch (err) {
      this._logger.log({ origin: 'listPasskeys', message: err.message, data: { user: req.user } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  public async deletePasskey(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const { id } = req.params;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const passkeyId = parseInt(id, 10);
      if (isNaN(passkeyId)) {
        return res.status(422).json({ message: 'Invalid passkey ID' });
      }

      const deleted = await this._passkeyService.deletePasskey({
        user_id: user.id_user,
        passkey_id: passkeyId,
      });

      if (!deleted) {
        return res.status(404).json({ message: 'Passkey not found' });
      }

      return res.json({
        success: true,
        message: 'Passkey deleted successfully',
      });
    } catch (err) {
      if (err.message.includes('Cannot delete last')) {
        return res.status(403).json({
          message: 'Cannot delete last authentication method',
        });
      }
      this._logger.log({ origin: 'deletePasskey', message: err.message, data: { user: req.user, params: req.params } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  public async renamePasskey(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const { id } = req.params;
      const { device_name } = req.body;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const passkeyId = parseInt(id, 10);
      if (isNaN(passkeyId)) {
        return res.status(422).json({ message: 'Invalid passkey ID' });
      }

      if (!device_name) {
        return res.status(422).json({ message: 'Device name is required' });
      }

      const updated = await this._passkeyService.renamePasskey({
        user_id: user.id_user,
        passkey_id: passkeyId,
        device_name,
      });

      if (!updated) {
        return res.status(404).json({ message: 'Passkey not found' });
      }

      return res.json({ success: true });
    } catch (err) {
      this._logger.log({ origin: 'renamePasskey', message: err.message, data: { user: req.user, params: req.params, body: req.body } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }

  // Auth method management
  public async listAuthMethods(
    req: IRequest,
    res: IResponse,
    _next?: INext,
  ): Promise<IResponse> {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const authMethods = await this._passkeyService.getUserAuthMethods(
        user.id_user,
      );

      // Transform to client-friendly format
      const methods = authMethods.map((method) => ({
        id: method.id_auth_method,
        type: method.auth_type,
        is_primary: method.is_primary,
        created_at: method.created_at,
      }));

      return res.json({ methods });
    } catch (err) {
      this._logger.log({ origin: 'listAuthMethods', message: err.message, data: { user: req.user } }, 'error');
      return res.status(500).json({ message: err.message });
    }
  }
}
