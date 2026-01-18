import crypto from 'crypto';
import { inject, injectable } from 'inversify';
import { Knex } from 'knex';
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
import { TYPES } from '../ContainerTypes';
import { ILoggerService } from '../interfaces/ILoggerService';
import type {
  PasskeyCredential,
  AuthMethod,
  PasskeyRegistrationOptionsResponse,
  PasskeyAuthOptionsResponse,
  PasskeyInfo,
  UserWithPublicId,
} from '../types/passkey';

@injectable()
export class PasskeyService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  private db = database;

  // WebAuthn configuration
  private readonly rpID = process.env.WEBAUTHN_RP_ID;
  private readonly rpName = process.env.WEBAUTHN_RP_NAME;
  private readonly origin = `https://${this.rpID}`;
  private readonly challengeTTL = parseInt('300', 10);

  // Registration
  async generateRegistrationOptions(params: {
    email: string;
    user_id?: number;
    device_name?: string;
  }): Promise<PasskeyRegistrationOptionsResponse> {
    try {
      const { email, user_id } = params;

      // Check if user exists
      const existingUser = await this.getUserByEmail(email);
      const userId = user_id || existingUser?.id_user;
      let userPublicId = existingUser?.public_id;

      // Get existing credentials to exclude
      const excludeCredentials: Array<{
        id: string;
        type: 'public-key';
        transports?: AuthenticatorTransportFuture[];
      }> = [];

      if (userId) {
        const existingPasskeys = await this.getUserPasskeyCredentials(userId);
        for (const passkey of existingPasskeys) {
          excludeCredentials.push({
            id: passkey.credential_id.toString('base64url'),
            type: 'public-key',
            transports: passkey.transports,
          });
        }
      }

      // Generate a temporary user ID if user doesn't exist yet
      if (!userPublicId) {
        userPublicId = crypto.randomUUID();
      }

      const options = await generateRegistrationOptions({
        rpName: this.rpName,
        rpID: this.rpID,
        userName: email,
        userDisplayName: email,
        userID: new Uint8Array(Buffer.from(userPublicId)),
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
      await this.storeChallenge({
        challenge: Buffer.from(options.challenge, 'base64url'),
        user_id: userId || null,
        email,
        challenge_type: 'registration',
      });

      return {
        challenge: options.challenge,
        user_id: userPublicId,
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
    user: UserWithPublicId;
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
      const storedChallenge = await this.getChallengeByValue(
        clientData.challenge,
      );

      if (!storedChallenge) {
        throw new Error('Challenge not found or expired');
      }

      // Delete the used challenge
      await this.deleteChallenge(storedChallenge.id_challenge);

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
      let user = await this.getUserByEmail(email, tx);

      if (!user) {
        // Create new user
        const [newUser] = await tx('users')
          .insert({
            email,
            password: '',
            public_id: crypto.randomUUID(),
          })
          .returning(['id_user', 'email', 'public_id', 'active']);

        user = newUser;
      }

      // Create auth_method entry
      const [authMethod] = await tx('auth_methods')
        .insert({
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: credential_id,
          metadata: JSON.stringify({ device_name }),
          is_primary: false,
        })
        .returning('id_auth_method');

      // Store the passkey credential
      // Note: credential.id is a Base64URLString in simplewebauthn v11+
      await tx('passkey_credentials').insert({
        auth_method_id: authMethod.id_auth_method,
        credential_id: Buffer.from(credential.id, 'base64url'),
        public_key: Buffer.from(credential.publicKey),
        counter: credential.counter,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        transports: transports || [],
        device_name: device_name || null,
      });

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
        const user = await this.getUserByEmail(email);
        if (user) {
          const passkeys = await this.getUserPasskeyCredentials(user.id_user);
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
      const user = email ? await this.getUserByEmail(email) : null;
      await this.storeChallenge({
        challenge: Buffer.from(options.challenge, 'base64url'),
        user_id: user?.id_user || null,
        email: email || null,
        challenge_type: 'authentication',
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
    user: UserWithPublicId;
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
      const passkey = await this.getPasskeyByCredentialId(credentialIdBuffer);

      if (!passkey) {
        throw new Error('Credential not found');
      }

      // Get challenge from clientDataJSON
      const clientData = JSON.parse(
        Buffer.from(client_data_json, 'base64url').toString('utf-8'),
      );
      const storedChallenge = await this.getChallengeByValue(
        clientData.challenge,
      );

      if (!storedChallenge) {
        throw new Error('Challenge not found or expired');
      }

      // Delete the used challenge
      await this.deleteChallenge(storedChallenge.id_challenge);

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
      await this.db('passkey_credentials')
        .where({ id_passkey: passkey.id_passkey })
        .update({
          counter: verification.authenticationInfo.newCounter,
          last_used_at: this.db.fn.now(),
          updated_at: this.db.fn.now(),
        });

      // Get user
      const user = await this.getUserByCredentialId(credentialIdBuffer);

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
    try {
      const expiresAt = moment().add(this.challengeTTL, 'seconds').toDate();

      const [result] = await this.db('webauthn_challenges')
        .insert({
          challenge: params.challenge,
          user_id: params.user_id || null,
          email: params.email || null,
          challenge_type: params.challenge_type,
          expires_at: expiresAt,
        })
        .returning('id_challenge');

      return result.id_challenge;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.storeChallenge',
        message: err.message,
        data: params,
      });
      throw err;
    }
  }

  async getAndDeleteChallenge(challengeBase64: string): Promise<{
    user_id: number | null;
    email: string | null;
    challenge_type: 'registration' | 'authentication';
  } | null> {
    try {
      const challengeBuffer = Buffer.from(challengeBase64, 'base64url');

      const challenge = await this.db('webauthn_challenges')
        .where({ challenge: challengeBuffer })
        .andWhere('expires_at', '>', new Date())
        .first();

      if (!challenge) {
        return null;
      }

      await this.db('webauthn_challenges')
        .where({ id_challenge: challenge.id_challenge })
        .del();

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

  private async getChallengeByValue(challengeBase64: string): Promise<{
    id_challenge: number;
    challenge: Buffer;
    user_id: number | null;
    email: string | null;
    challenge_type: 'registration' | 'authentication';
  } | null> {
    try {
      const challengeBuffer = Buffer.from(challengeBase64, 'base64url');

      const challenge = await this.db('webauthn_challenges')
        .where({ challenge: challengeBuffer })
        .andWhere('expires_at', '>', new Date())
        .first();

      return challenge || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getChallengeByValue',
        message: err.message,
        data: { challengeBase64 },
      });
      return null;
    }
  }

  private async deleteChallenge(id_challenge: number): Promise<void> {
    await this.db('webauthn_challenges').where({ id_challenge }).del();
  }

  // Credential management
  async getUserPasskeys(user_id: number): Promise<PasskeyInfo[]> {
    try {
      const passkeys = await this.db('passkey_credentials as pc')
        .select(
          'pc.id_passkey',
          'pc.device_name',
          'pc.device_type',
          'pc.backed_up',
          'pc.last_used_at',
          'pc.created_at',
        )
        .join('auth_methods as am', 'am.id_auth_method', 'pc.auth_method_id')
        .where({
          'am.user_id': user_id,
          'am.active': true,
          'pc.active': true,
        });

      return passkeys;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getUserPasskeys',
        message: err.message,
        data: { user_id },
      });
      return [];
    }
  }

  private async getUserPasskeyCredentials(
    user_id: number,
  ): Promise<PasskeyCredential[]> {
    try {
      const passkeys = await this.db('passkey_credentials as pc')
        .select('pc.*')
        .join('auth_methods as am', 'am.id_auth_method', 'pc.auth_method_id')
        .where({
          'am.user_id': user_id,
          'am.active': true,
          'pc.active': true,
        });

      return passkeys;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getUserPasskeyCredentials',
        message: err.message,
        data: { user_id },
      });
      return [];
    }
  }

  private async getPasskeyByCredentialId(
    credential_id: Buffer,
  ): Promise<PasskeyCredential | null> {
    try {
      const passkey = await this.db('passkey_credentials')
        .where({ credential_id, active: true })
        .first();

      return passkey || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getPasskeyByCredentialId',
        message: err.message,
        data: { credential_id: credential_id.toString('base64url') },
      });
      return null;
    }
  }

  async deletePasskey(params: {
    user_id: number;
    passkey_id: number;
  }): Promise<boolean> {
    try {
      const { user_id, passkey_id } = params;

      // Verify user owns this passkey
      const passkey = await this.db('passkey_credentials as pc')
        .join('auth_methods as am', 'am.id_auth_method', 'pc.auth_method_id')
        .where({
          'pc.id_passkey': passkey_id,
          'am.user_id': user_id,
          'pc.active': true,
        })
        .first();

      if (!passkey) {
        return false;
      }

      // Check if user has other auth methods
      const authMethodCount = await this.getAuthMethodCount(user_id);
      if (authMethodCount <= 1) {
        throw new Error('Cannot delete last authentication method');
      }

      // Soft delete
      await this.db('passkey_credentials')
        .where({ id_passkey: passkey_id })
        .update({
          active: false,
          updated_at: this.db.fn.now(),
        });

      await this.db('auth_methods')
        .where({ id_auth_method: passkey.auth_method_id })
        .update({
          active: false,
          updated_at: this.db.fn.now(),
        });

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
      const { user_id, passkey_id, device_name } = params;

      // Verify user owns this passkey
      const passkey = await this.db('passkey_credentials as pc')
        .join('auth_methods as am', 'am.id_auth_method', 'pc.auth_method_id')
        .where({
          'pc.id_passkey': passkey_id,
          'am.user_id': user_id,
          'pc.active': true,
        })
        .first();

      if (!passkey) {
        return false;
      }

      await this.db('passkey_credentials')
        .where({ id_passkey: passkey_id })
        .update({
          device_name,
          updated_at: this.db.fn.now(),
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
    try {
      const authMethods = await this.db('auth_methods')
        .where({ user_id, active: true })
        .orderBy('created_at', 'asc');

      return authMethods;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getUserAuthMethods',
        message: err.message,
        data: { user_id },
      });
      return [];
    }
  }

  async getAuthMethodCount(user_id: number): Promise<number> {
    try {
      const result = await this.db('auth_methods')
        .where({ user_id, active: true })
        .count('id_auth_method as count')
        .first();

      return parseInt(result?.count as string, 10) || 0;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getAuthMethodCount',
        message: err.message,
        data: { user_id },
      });
      return 0;
    }
  }

  // User lookup
  async getUserByEmail(
    email: string,
    trx?: Knex.Transaction,
  ): Promise<UserWithPublicId | null> {
    try {
      const db = trx || this.db;
      const user = await db('users')
        .where({ email, active: true })
        .select('id_user', 'email', 'public_id', 'active')
        .first();

      return user || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getUserByEmail',
        message: err.message,
        data: { email },
      });
      return null;
    }
  }

  async getUserByCredentialId(
    credential_id: Buffer,
  ): Promise<UserWithPublicId | null> {
    try {
      const user = await this.db('users as u')
        .select('u.id_user', 'u.email', 'u.public_id', 'u.active')
        .join('auth_methods as am', 'am.user_id', 'u.id_user')
        .join(
          'passkey_credentials as pc',
          'pc.auth_method_id',
          'am.id_auth_method',
        )
        .where({
          'pc.credential_id': credential_id,
          'pc.active': true,
          'am.active': true,
          'u.active': true,
        })
        .first();

      return user || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getUserByCredentialId',
        message: err.message,
        data: { credential_id: credential_id.toString('base64url') },
      });
      return null;
    }
  }

  // Token generation
  async generateToken(user: UserWithPublicId): Promise<string> {
    const token = JWT.sign(
      JSON.stringify({
        id_user: user.id_user,
        email: user.email,
        public_id: user.public_id,
        time: moment().unix(),
      }),
      process.env.APP_SECRET,
    );
    return token;
  }

  // Get RevenueCat ID for user (Apple ID if exists, else public_id)
  async getRevenueCatId(user_id: number, public_id: string): Promise<string> {
    try {
      // Check if user has an Apple auth method
      const appleAuthMethod = await this.db('auth_methods')
        .where({
          user_id,
          auth_type: 'apple',
          active: true,
        })
        .first();

      if (appleAuthMethod) {
        return appleAuthMethod.external_id;
      }

      // Fall back to public_id for passkey-only users
      return public_id;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.getRevenueCatId',
        message: err.message,
        data: { user_id },
      });
      return public_id;
    }
  }

  // Check if user has active subscription
  async hasSubscription(user_id: number): Promise<boolean> {
    try {
      const subscription = await this.db('user_params')
        .where({
          user_id,
          param: 'subscription',
          active: true,
        })
        .first();

      return !!subscription;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyService.hasSubscription',
        message: err.message,
        data: { user_id },
      });
      return false;
    }
  }
}
