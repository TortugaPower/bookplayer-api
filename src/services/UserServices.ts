import crypto from 'crypto';
import { inject, injectable } from 'inversify';
import {
  AppleJWT,
  SignApple,
  SubscriptionUser,
  TypeUserParams,
  User,
  UserEvent,
  UserEventEnum,
  UserParam,
  UserParamsObject,
  UserSession,
} from '../types/user';
import verifyAppleToken from 'verify-apple-id-token';
import { Knex } from 'knex';
import database from '../database';
import JWT from 'jsonwebtoken';
import moment from 'moment';
import { ILoggerService } from '../interfaces/ILoggerService';
import { TYPES } from '../ContainerTypes';
@injectable()
export class UserServices {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  private db = database;
  async TokenUser(UserLogged: User): Promise<string> {
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
        origin: 'verifyToken',
        message: err.message,
        data: { token_id },
      });
      return null;
    }
  }

  async GetUser(
    { email, session }: UserSession,
    trx?: Knex.Transaction,
  ): Promise<User> {
    try {
      const db = trx || this.db;
      const user = await db('users as usr')
        .select('usr.id_user', 'usr.email', 'params.* as params', 'ud.session')
        .joinRaw(
          `left join lateral (
          select json_object_agg(p.param, p.value) as params from (
          select up.param, up.value from user_params up where up.user_id=usr.id_user and up.active= true
          ) as p
        ) as params on true`,
        )
        .leftJoin('user_devices as ud', function () {
          this.on('usr.id_user', '=', 'ud.user_id').andOn(
            'ud.session',
            '=',
            db.raw('?', [session || '']),
          );
        })
        .where({
          email,
          'usr.active': true,
        })
        .first();
      return user;
    } catch (err) {
      this._logger.log({
        origin: 'GetUser',
        message: err.message,
        data: { email, session },
      });
      return null;
    }
  }

  async getUserParam(
    params: {
      user_id: number;
      param: TypeUserParams;
    },
    trx?: Knex.Transaction,
  ): Promise<string> {
    try {
      const db = trx || this.db;
      const userParam = await db('user_params')
        .where({
          user_id: params.user_id,
          active: true,
          param: params.param,
        })
        .first();
      return userParam?.value;
    } catch (err) {
      this._logger.log({
        origin: 'GetUserParam',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async AddNewUser(newUser: User, trx?: Knex.Transaction): Promise<User> {
    const tx = trx || (await this.db.transaction());
    try {
      const { email, external_id } = newUser;
      const userCreated = await tx('users')
        .insert({
          email,
          password: '',
          external_id: external_id || crypto.randomUUID(),
        })
        .returning('*');
      await tx.commit();
      return {
        ...userCreated[0],
      };
    } catch (err) {
      await tx.rollback();
      this._logger.log({
        origin: 'AddNewUser',
        message: err.message,
        data: { newUser },
      });
      return null;
    }
  }

  async AddNewDevice(
    userSession: UserSession,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      const { session, user_id } = userSession;
      const db = trx || this.db;
      const deviceCreated = await db('user_devices')
        .insert({
          user_id,
          session,
          device_os: 'ios',
        })
        .returning('id_user_device');
      return deviceCreated[0];
    } catch (err) {
      this._logger.log({
        origin: 'AddNewDevice',
        message: err.message,
        data: { userSession },
      });
      return null;
    }
  }

  async GetUserByExternalId(
    external_ids: string[],
    trx?: Knex.Transaction,
  ): Promise<SubscriptionUser> {
    try {
      const db = trx || this.db;
      const user = await db('users')
        .select('id_user', 'email', 'external_id')
        .where({ active: true })
        .whereIn('external_id', external_ids)
        .first();
      return user;
    } catch (err) {
      this._logger.log({
        origin: 'GetUserByExternalId',
        message: err.message,
        data: { external_ids },
      });
      return null;
    }
  }

  async UpdateSubscription(
    user_id: number,
    subscription: string,
  ): Promise<boolean> {
    try {
      await this.db('user_params')
        .update({
          updated_at: this.db.fn.now(),
          active: false,
        })
        .where({
          active: true,
          param: TypeUserParams.subscription,
          user_id,
        });
      await this.db('user_params')
        .insert({
          param: TypeUserParams.subscription,
          value: subscription,
          user_id,
        })
        .returning('id_param');
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'UpdateSubscription',
        message: err.message,
        data: { user_id, subscription },
      });
      return false;
    }
  }

  async DeleteAccount(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const tx = trx || (await this.db.transaction());
    try {
      await tx('user_params')
        .update({
          updated_at: tx.fn.now(),
          active: false,
          value: tx.raw("concat(user_params.value, '-deleted')"),
        })
        .where({
          active: true,
          user_id,
        });
      await tx('user_devices')
        .update({
          updated_at: tx.fn.now(),
          active: false,
          session: tx.raw("concat(user_devices.session, '-deleted')"),
        })
        .where({
          active: true,
          user_id,
        });
      await tx('users')
        .update({
          updated_at: tx.fn.now(),
          active: false,
          email: tx.raw(
            `concat(users.email, '-deleted', '${moment().unix()}')`,
          ),
        })
        .where({
          active: true,
          id_user: user_id,
        });
      await tx.commit();
      return true;
    } catch (err) {
      await tx.rollback();
      this._logger.log({
        origin: 'DeleteAccount',
        message: err.message,
        data: { user_id },
      });
      return false;
    }
  }

  async getUserSubscriptionState(user_id: number): Promise<string> {
    try {
      // After migration, external_id contains Apple ID for Apple users or UUID for passkey users
      // This allows us to search subscription_events directly without joining user_params
      const userState = await this.db
        .raw(
          `
        select usr.id_user, usr.email, usr.external_id,
          coalesce(subscription_one.period_type, subscription_two.period_type, subscription_aliases.period_type) as period_type,
          coalesce(subscription_one.type, subscription_two.type, subscription_aliases.type) as type
        from users usr
        left join lateral (
          select * from subscription_events sevent where sevent.original_app_user_id=usr.external_id
          order by sevent.id_subscription_event desc limit 1
        ) as subscription_one on true
        left join lateral (
          select * from subscription_events sevent where replace((sevent.json -> 'app_user_id')::varchar, '"', '') = usr.external_id
          order by sevent.id_subscription_event desc limit 1
        ) as subscription_two on true
        left join lateral (
            select * from subscription_events sevent
            WHERE EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(json->'aliases') AS elem
                WHERE elem = usr.external_id
            ) order by sevent.id_subscription_event desc limit 1
        ) as subscription_aliases on true
        where usr.id_user=? and coalesce(subscription_one.type, subscription_two.type, subscription_aliases.type) is not null
      `,
          [user_id],
        )
        .then((res) => res.rows[0]);
      return userState?.type || null;
    } catch (err) {
      this._logger.log({
        origin: 'getUserSubscriptionState',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  async getClientID(params: { origin: string }): Promise<{
    apple_id: string;
    app_version: string;
  }> {
    try {
      const { origin } = params;
      const client = await this.db('apple_clients')
        .where({
          active: true,
          origin,
        })
        .select(['apple_id', 'app_version'])
        .first();
      return client;
    } catch (err) {
      this._logger.log({
        origin: 'getClientID',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async checkIfAdmin(user_id: number): Promise<boolean> {
    try {
      const isAdmin = await this.db('admin_users')
        .where({
          user_id,
          active: true,
        })
        .first();
      return !!isAdmin;
    } catch (err) {
      this._logger.log({
        origin: 'checkIfAdmin',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  async insertNewEvent(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
    event_data: object;
  }): Promise<number> {
    try {
      const inserted = await this.db('user_events')
        .insert(params)
        .returning('id_user_event');
      return inserted[0].id_user_event;
    } catch (err) {
      this._logger.log({
        origin: 'insertNewEvent',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getLastUserEvent(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
  }): Promise<UserEvent> {
    try {
      const filter: {
        event_name?: UserEventEnum;
        user_id?: number;
        external_id?: string;
      } = {};
      if (params.user_id) {
        filter.user_id = params.user_id;
      }
      if (params.external_id) {
        filter.external_id = params.external_id;
      }
      filter.event_name = params.event_name;
      const event = await this.db('user_events')
        .where(filter)
        .orderBy('created_at', 'desc')
        .first();
      return event;
    } catch (err) {
      this._logger.log({
        origin: 'getLastUserEvent',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getUserEventCount(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
  }): Promise<number> {
    try {
      const filter: {
        event_name?: UserEventEnum;
        user_id?: number;
        external_id?: string;
      } = {};
      if (params.user_id) {
        filter.user_id = params.user_id;
      }
      if (params.external_id) {
        filter.external_id = params.external_id;
      }
      filter.event_name = params.event_name;
      const total_count = await this.db('user_events').where(filter).count();
      return Number(total_count[0]['count']);
    } catch (err) {
      this._logger.log({
        origin: 'getUserEventCount',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getSecondOnboardings(params: { onboarding_name: string }): Promise<{
    [k: string]: object;
  }> {
    try {
      const response = await this.db
        .raw(
          `select json_build_object(
            'onboarding_name', onboarding_name,
            'onboarding_id', onboarding_id,
            'type', type,
            'support', response_data
            ) as response from second_onboardings
          where onboarding_name=? and active=true`,
          [params.onboarding_name],
        )
        .then((result) => result.rows[0]);
      return response?.response;
    } catch (err) {
      this._logger.log({
        origin: 'getSecondOnboardings',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  // ============================================
  // Duplicate Prevention Methods
  // ============================================

  /**
   * Look up an auth method by its external ID (e.g., Apple's "sub" claim)
   * Used to find existing users when they change their Apple ID email
   */
  async GetAuthMethodByExternalId(params: {
    auth_type: string;
    external_id: string;
  }): Promise<{
    user_id: number;
    id_auth_method: number;
    email: string;
  } | null> {
    try {
      const authMethod = await this.db('auth_methods as am')
        .select('am.user_id', 'am.id_auth_method', 'u.email')
        .join('users as u', 'u.id_user', 'am.user_id')
        .where({
          'am.auth_type': params.auth_type,
          'am.external_id': params.external_id,
          'am.active': true,
          'u.active': true,
        })
        .first();

      return authMethod || null;
    } catch (err) {
      this._logger.log({
        origin: 'GetAuthMethodByExternalId',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  /**
   * Add an auth method for a user
   * Used when creating new users or linking additional auth methods
   */
  async AddAuthMethod(
    params: {
      user_id: number;
      auth_type: string;
      external_id: string;
      is_primary?: boolean;
      metadata?: object;
    },
    trx?: Knex.Transaction,
  ): Promise<{ id_auth_method: number } | null> {
    try {
      const db = trx || this.db;
      const [inserted] = await db('auth_methods')
        .insert({
          user_id: params.user_id,
          auth_type: params.auth_type,
          external_id: params.external_id,
          is_primary: params.is_primary ?? false,
          metadata: params.metadata ?? {},
        })
        .returning('id_auth_method');

      return { id_auth_method: inserted.id_auth_method };
    } catch (err) {
      // Check for unique constraint violation (duplicate auth method)
      if (err.code === '23505') {
        this._logger.log({
          origin: 'AddAuthMethod',
          message: 'Duplicate auth method attempted',
          data: { params },
        });
        return null;
      }
      this._logger.log({
        origin: 'AddAuthMethod',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }
}
