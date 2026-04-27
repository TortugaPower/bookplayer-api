import {
  AppleJWT,
  SignApple,
  SubscriptionUser,
  User,
  UserEvent,
  UserEventEnum,
  UserSession,
} from '../types/user';
import verifyAppleToken from 'verify-apple-id-token';
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
      this._logger.log({
        origin: 'UserServices.verifyToken',
        message: err.message,
        data: { token_id },
      });
      return null;
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
