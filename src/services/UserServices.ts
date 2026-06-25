import {
  AppleJWT,
  SignApple,
  SubscriptionUser,
  User,
  UserEvent,
  UserEventEnum,
  UserSession,
  VerificationResult,
  UserState,
} from '../types/user';
import verifyAppleToken from 'verify-apple-id-token';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { Knex } from 'knex';
import database from '../database';
import JWT from 'jsonwebtoken';
import moment from 'moment';
import { logger } from './LoggerService';
import { UserDB } from './db/UserDB';
import { SubscriptionService } from './SubscriptionService';

export class UserServices {
  private readonly _logger = logger;
  private db = database;
  private googleClient = new OAuth2Client();
  
  constructor(
    private _userDB: UserDB = new UserDB(),
    private _subscriptionService: SubscriptionService = new SubscriptionService(),
  ) {}

  async tokenUser(UserLogged: User): Promise<string> {
    const token = JWT.sign(
      JSON.stringify({ ...UserLogged, time: moment().unix() }),
      process.env.APP_SECRET,
    );
    return token;
  }

  async verifyToken({ token_id, client_id }: SignApple): Promise<AppleJWT> {
    try {
      const defaultClientID = process.env.APPLE_CLIENT_ID;
      const decriptJWT = await verifyAppleToken({
        idToken: token_id,
        clientId: client_id || defaultClientID,
      });

      return decriptJWT;
    } catch (err) {
      // Do not log the raw ID token — it's a bearer credential not covered by
      // the logger's (exact-key) redaction.
      this._logger.log({
        origin: 'UserServices.verifyToken',
        message: err.message,
      });
      return null;
    }
  }

  async verifyGoogleToken(idToken: string): Promise<VerificationResult> {
    try {
      // GOOGLE_CLIENT_ID is validated as required at boot (config/envs.ts), so
      // it's guaranteed present here. Passing it as the audience ensures we only
      // accept ID tokens minted for our own Google client (never another app's).
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID!,
      });

      // ticket.getPayload() returns TokenPayload | undefined
      const payload: TokenPayload | undefined = ticket.getPayload();
      
      if (!payload) {
        return { success: false, error: 'Token payload is empty' };
      }
      
      const userId = payload.sub;
      const email = payload.email;
      const name = payload.name;
      const picture = payload.picture;

      // Require a stable subject (used as external_id) and only trust the email
      // if Google says it's verified. The login flow keys accounts on external_id
      // and links by email, so a missing sub or unverified address must never be
      // treated as a valid identity.
      if (!userId || !email || !payload.email_verified) {
        return { success: false, error: 'Token is missing a subject, email, or a verified email' };
      }

      return {
        success: true,
        user: { userId, email, name, picture },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      // Do not log the raw ID token — it's a bearer credential and `token_id`
      // is not covered by the logger's redaction (it matches keys exactly). The
      // error message alone is enough to diagnose verification failures.
      this._logger.log({
        origin: 'UserServices.verifyGoogleToken',
        message: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  async getUser(params: UserSession, trx?: Knex.Transaction): Promise<User> {
    return this._userDB.getUser(params, trx);
  }

  async addNewUser(newUser: User, trx?: Knex.Transaction): Promise<User> {
    const tx = trx || (await this.db.transaction());
    try {
      const user = await this._userDB.insertUser(newUser, tx);
      if (!trx) await tx.commit();
      return user;
    } catch (err) {
      if (!trx) await tx.rollback();
      this._logger.log({
        origin: 'UserServices.addNewUser',
        message: err.message,
        data: { newUser },
      });
      return null;
    }
  }

  async addNewDevice(
    userSession: UserSession,
    trx?: Knex.Transaction,
  ): Promise<number> {
    return this._userDB.insertDevice(userSession, trx);
  }

  async getUserByExternalId(
    external_ids: string[],
    trx?: Knex.Transaction,
  ): Promise<SubscriptionUser> {
    return this._userDB.getUserByExternalId(external_ids, trx);
  }

  async deleteAccount(
    user_id: number,
    external_id?: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const tx = trx || (await this.db.transaction());
    try {
      await this._userDB.softDeleteUserDevices(user_id, tx);
      await this._userDB.softDeleteUser(user_id, tx);
      await this._userDB.softDeleteAuthMethods(user_id, tx);
      if (!trx) await tx.commit();
      if (external_id) {
        await this._subscriptionService.invalidateCache(external_id);
      }
      return true;
    } catch (err) {
      if (!trx) await tx.rollback();
      this._logger.log({
        origin: 'UserServices.deleteAccount',
        message: err.message,
        data: { user_id },
      });
      return false;
    }
  }

  async getClientID(params: { origin: string }): Promise<{
    apple_id: string;
    app_version: string;
  }> {
    return this._userDB.getClientID(params);
  }

  async insertNewEvent(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
    event_data: object;
  }): Promise<number> {
    return this._userDB.insertUserEvent(params);
  }

  async getLastUserEvent(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
  }): Promise<UserEvent> {
    return this._userDB.getLastUserEvent(params);
  }

  async getUserEventCount(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
  }): Promise<number> {
    return this._userDB.getUserEventCount(params);
  }

  async getSecondOnboardings(params: { onboarding_name: string }): Promise<{
    [k: string]: object;
  }> {
    return this._userDB.getSecondOnboarding(params);
  }

  async getAuthMethodByExternalId(params: {
    auth_type: string;
    external_id: string;
  }): Promise<{
    user_id: number;
    id_auth_method: number;
    email: string;
  } | null> {
    return this._userDB.getAuthMethodByExternalId(params);
  }

  async addAuthMethod(
    params: {
      user_id: number;
      auth_type: string;
      external_id: string;
      is_primary?: boolean;
      metadata?: object;
    },
    trx?: Knex.Transaction,
  ): Promise<{ id_auth_method: number } | null> {
    return this._userDB.insertAuthMethod(params, trx);
  }
}
