import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';
import JWT from 'jsonwebtoken';
import moment from 'moment';
import database from '../database';
import { logger } from './LoggerService';
import { PasskeyDB } from './db/PasskeyDB';
import { UserDB } from './db/UserDB';
import type {
  AuthMethod,
  PasskeyAuthOptionsResponse,
  PasskeyInfo,
  PasskeyRegistrationOptionsResponse,
  UserWithExternalId,
} from '../types/passkey';

export class PasskeyService {
  private readonly _logger = logger;
  private db = database;

  constructor(
    private _passkeyDB: PasskeyDB = new PasskeyDB(),
    private _userDB: UserDB = new UserDB(),
  ) {}

  // WebAuthn configuration
  private readonly rpID = process.env.WEBAUTHN_RP_ID;
  private readonly rpName = process.env.WEBAUTHN_RP_NAME;
  private readonly origin = `https://${this.rpID}`;
  private readonly challengeTTL = 300;

  // Registration
  async generateRegistrationOptions(params: {
    email: string;
    user_id?: number;
    device_name?: string;
  }): Promise<PasskeyRegistrationOptionsResponse> {
    try {
      const { email, user_id } = params;

      // Check if user exists
      const existingUser = await this._passkeyDB.getUserByEmail(email);
      const userId = user_id || existingUser?.id_user;
      let userExternalId = existingUser?.external_id;

      // Get existing credentials to exclude
      const excludeCredentials: Array<{
        id: string;
        type: 'public-key';
        transports?: AuthenticatorTransportFuture[];
      }> = [];

      if (userId) {
        const existingPasskeys = await this._passkeyDB.getUserPasskeyCredentials(userId);
        for (const passkey of existingPasskeys) {
          excludeCredentials.push({
            id: passkey.credential_id.toString('base64url'),
            type: 'public-key',
            transports: passkey.transports,
          });
        }
      }

      // Generate a temporary user ID if user doesn't exist yet
      if (!userExternalId) {
        userExternalId = crypto.randomUUID();
      }

      const options = await generateRegistrationOptions({
        rpName: this.rpName,
        rpID: this.rpID,
        userName: email,
        userDisplayName: email,
        userID: new Uint8Array(Buffer.from(userExternalId)),
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
          authenticatorAttachment: 'platform',
        },
        timeout: 60000,
      });

      // Store challenge
      await this._passkeyDB.storeChallenge({
        challenge: Buffer.from(options.challenge, 'base64url'),
        user_id: userId || null,
        email,
        challenge_type: 'registration',
        ttlSeconds: this.challengeTTL,
      });

      return {
        challenge: options.challenge,
        user_id: userExternalId,
        rp_id: this.rpID,
        rp_name: this.rpName,
        timeout: 60000,
        user_name: email,
        user_display_name: email,
        exclude_credentials: excludeCredentials,
      };
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.generateRegistrationOptions',
        message: err.message,
        data: { email: params.email },
      });
      throw err;
    }
  }

  async verifyRegistration(params: {
    email: string;
    credential_id: string;
    attestation_object: string;
    client_data_json: string;
    transports?: string[];
    device_name?: string;
    user_id?: number;
  }): Promise<{
    verified: boolean;
    user: UserWithExternalId;
    token: string;
  }> {
    const tx = await this.db.transaction();
    try {
      const {
        email,
        credential_id,
        attestation_object,
        client_data_json,
        transports,
        device_name,
      } = params;

      // Extract challenge from clientDataJSON
      const clientData = JSON.parse(
        Buffer.from(client_data_json, 'base64url').toString('utf-8'),
      );
      const storedChallenge = await this._passkeyDB.getChallengeByValue(
        clientData.challenge,
      );

      if (!storedChallenge) {
        throw new Error('Challenge not found or expired');
      }

      // Delete the used challenge
      await this._passkeyDB.deleteChallenge(storedChallenge.id_challenge);

      // Verify the registration response
      const verification = await verifyRegistrationResponse({
        response: {
          id: credential_id,
          rawId: credential_id,
          response: {
            attestationObject: attestation_object,
            clientDataJSON: client_data_json,
            transports: transports as AuthenticatorTransportFuture[],
          },
          type: 'public-key',
          clientExtensionResults: {},
        },
        expectedChallenge: storedChallenge.challenge.toString('base64url'),
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        throw new Error('Registration verification failed');
      }

      const { credential, credentialDeviceType, credentialBackedUp } =
        verification.registrationInfo;

      // Get or create user
      let user = await this._passkeyDB.getUserByEmail(email, tx);

      if (!user) {
        // Create new user via UserDB
        const newUser = await this._userDB.insertUser(
          { email, active: true, external_id: crypto.randomUUID() },
          tx,
        );
        if (!newUser) {
          throw new Error('Failed to create user');
        }
        user = newUser as UserWithExternalId;
      }

      // Create auth_method entry via UserDB
      const authMethod = await this._userDB.insertAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: credential_id,
          metadata: { device_name },
          is_primary: false,
        },
        tx,
      );

      // Store the passkey credential
      await this._passkeyDB.insertPasskeyCredential(
        {
          auth_method_id: authMethod.id_auth_method,
          credential_id: Buffer.from(credential.id, 'base64url'),
          public_key: Buffer.from(credential.publicKey),
          counter: credential.counter,
          device_type: credentialDeviceType,
          backed_up: credentialBackedUp,
          transports,
          device_name,
        },
        tx,
      );

      await tx.commit();

      // Generate token
      const token = await this.generateToken(user);

      return {
        verified: true,
        user,
        token,
      };
    } catch (err) {
      await tx.rollback();
      this._logger.log({
        origin: 'PasskeyService.verifyRegistration',
        message: err.message,
        data: { email: params.email },
      });
      throw err;
    }
  }

  // Authentication
  async generateAuthenticationOptions(params: {
    email?: string;
  }): Promise<PasskeyAuthOptionsResponse> {
    try {
      const { email } = params;

      let allowCredentials:
        | Array<{
          id: string;
          type: 'public-key';
          transports?: AuthenticatorTransportFuture[];
        }>
        | undefined;

      // If email is provided, get credentials for that user
      if (email) {
        const user = await this._passkeyDB.getUserByEmail(email);
        if (user) {
          const passkeys = await this._passkeyDB.getUserPasskeyCredentials(user.id_user);
          allowCredentials = passkeys.map((p) => ({
            id: p.credential_id.toString('base64url'),
            type: 'public-key' as const,
            transports: p.transports,
          }));
        }
      }

      const options = await generateAuthenticationOptions({
        rpID: this.rpID,
        userVerification: 'required',
        timeout: 60000,
        allowCredentials,
      });

      // Store challenge
      const user = email ? await this._passkeyDB.getUserByEmail(email) : null;
      await this._passkeyDB.storeChallenge({
        challenge: Buffer.from(options.challenge, 'base64url'),
        user_id: user?.id_user || null,
        email: email || null,
        challenge_type: 'authentication',
        ttlSeconds: this.challengeTTL,
      });

      return {
        challenge: options.challenge,
        timeout: 60000,
        rp_id: this.rpID,
        allow_credentials: allowCredentials,
      };
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.generateAuthenticationOptions',
        message: err.message,
        data: { email: params.email },
      });
      throw err;
    }
  }

  async verifyAuthentication(params: {
    credential_id: string;
    authenticator_data: string;
    client_data_json: string;
    signature: string;
    user_handle?: string;
  }): Promise<{
    verified: boolean;
    user: UserWithExternalId;
    token: string;
  }> {
    try {
      const {
        credential_id,
        authenticator_data,
        client_data_json,
        signature,
        user_handle,
      } = params;

      // Find the credential
      const credentialIdBuffer = Buffer.from(credential_id, 'base64url');
      const passkey = await this._passkeyDB.getPasskeyByCredentialId(credentialIdBuffer);

      if (!passkey) {
        throw new Error('Credential not found');
      }

      // Get challenge from clientDataJSON
      const clientData = JSON.parse(
        Buffer.from(client_data_json, 'base64url').toString('utf-8'),
      );
      const storedChallenge = await this._passkeyDB.getChallengeByValue(
        clientData.challenge,
      );

      if (!storedChallenge) {
        throw new Error('Challenge not found or expired');
      }

      // Delete the used challenge
      await this._passkeyDB.deleteChallenge(storedChallenge.id_challenge);

      // Verify the authentication response
      const verification = await verifyAuthenticationResponse({
        response: {
          id: credential_id,
          rawId: credential_id,
          response: {
            authenticatorData: authenticator_data,
            clientDataJSON: client_data_json,
            signature,
            userHandle: user_handle,
          },
          type: 'public-key',
          clientExtensionResults: {},
        },
        expectedChallenge: storedChallenge.challenge.toString('base64url'),
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credential_id.toString('base64url'),
          publicKey: new Uint8Array(passkey.public_key),
          counter: passkey.counter,
          transports: passkey.transports,
        },
      });

      if (!verification.verified) {
        throw new Error('Authentication verification failed');
      }

      // Update counter
      await this._passkeyDB.updatePasskeyCounter({
        id_passkey: passkey.id_passkey,
        counter: verification.authenticationInfo.newCounter,
      });

      // Get user
      const user = await this._passkeyDB.getUserByCredentialId(credentialIdBuffer);

      if (!user) {
        throw new Error('User not found');
      }

      // Generate token
      const token = await this.generateToken(user);

      return {
        verified: true,
        user,
        token,
      };
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.verifyAuthentication',
        message: err.message,
        data: { credential_id: params.credential_id },
      });
      throw err;
    }
  }

  // Challenge management

  async storeChallenge(params: {
    challenge: Buffer;
    user_id?: number;
    email?: string;
    challenge_type: 'registration' | 'authentication';
  }): Promise<number> {
    return this._passkeyDB.storeChallenge({
      ...params,
      ttlSeconds: this.challengeTTL,
    });
  }

  async getAndDeleteChallenge(challengeBase64: string): Promise<{
    user_id: number | null;
    email: string | null;
    challenge_type: 'registration' | 'authentication';
  } | null> {
    try {
      const challenge = await this._passkeyDB.getChallengeByValue(challengeBase64);
      if (!challenge) return null;
      await this._passkeyDB.deleteChallenge(challenge.id_challenge);
      return {
        user_id: challenge.user_id,
        email: challenge.email,
        challenge_type: challenge.challenge_type,
      };
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getAndDeleteChallenge',
        message: err.message,
        data: { challengeBase64 },
      });
      return null;
    }
  }

  // Credential management

  async getUserPasskeys(user_id: number): Promise<PasskeyInfo[]> {
    return this._passkeyDB.getUserPasskeys(user_id);
  }

  async deletePasskey(params: {
    user_id: number;
    passkey_id: number;
  }): Promise<boolean> {
    try {
      const passkey = await this._passkeyDB.getPasskeyWithAuthMethod(params);
      if (!passkey) return false;

      // Check if user has other auth methods
      const authMethodCount = await this._passkeyDB.getAuthMethodCount(params.user_id);
      if (authMethodCount <= 1) {
        throw new Error('Cannot delete last authentication method');
      }

      await this._passkeyDB.softDeletePasskey(params.passkey_id);
      await this._passkeyDB.softDeleteAuthMethod(passkey.auth_method_id);
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.deletePasskey',
        message: err.message,
        data: params,
      });
      throw err;
    }
  }

  async renamePasskey(params: {
    user_id: number;
    passkey_id: number;
    device_name: string;
  }): Promise<boolean> {
    try {
      const passkey = await this._passkeyDB.getPasskeyWithAuthMethod({
        user_id: params.user_id,
        passkey_id: params.passkey_id,
      });
      if (!passkey) return false;

      await this._passkeyDB.updatePasskeyDeviceName({
        id_passkey: params.passkey_id,
        device_name: params.device_name,
      });
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.renamePasskey',
        message: err.message,
        data: params,
      });
      return false;
    }
  }

  // Auth method management

  async getUserAuthMethods(user_id: number): Promise<AuthMethod[]> {
    return this._passkeyDB.getUserAuthMethods(user_id);
  }

  async getAuthMethodCount(user_id: number): Promise<number> {
    return this._passkeyDB.getAuthMethodCount(user_id);
  }

  // User lookup

  async getUserByEmail(email: string): Promise<UserWithExternalId | null> {
    return this._passkeyDB.getUserByEmail(email);
  }

  async getUserByCredentialId(
    credential_id: Buffer,
  ): Promise<UserWithExternalId | null> {
    return this._passkeyDB.getUserByCredentialId(credential_id);
  }

  // Token generation

  async generateToken(user: UserWithExternalId): Promise<string> {
    const token = JWT.sign(
      JSON.stringify({
        id_user: user.id_user,
        email: user.email,
        external_id: user.external_id,
        time: moment().unix(),
      }),
      process.env.APP_SECRET,
    );
    return token;
  }

  // Get RevenueCat ID for user (Apple ID if exists, else external_id)
  async getRevenueCatId(user_id: number, external_id: string): Promise<string> {
    try {
      const appleAuthMethod = await this._passkeyDB.getAppleAuthMethod(user_id);
      if (appleAuthMethod) {
        return appleAuthMethod.external_id;
      }
      return external_id;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getRevenueCatId',
        message: err.message,
        data: { user_id },
      });
      return external_id;
    }
  }

  // Check if user has active subscription
  async hasSubscription(user_id: number): Promise<boolean> {
    return this._passkeyDB.hasSubscriptionParam(user_id);
  }
}
