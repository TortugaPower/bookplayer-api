import { Knex } from 'knex';
import crypto from 'crypto';
import database from '../../database';
import { logger } from '../LoggerService';
import {
  SubscriptionUser,
  User,
  UserEvent,
  UserEventEnum,
  UserSession,
} from '../../types/user';

export class UserDB {
  private readonly _logger = logger;
  private db = database;

  async getUser(
    { email, session }: UserSession,
    trx?: Knex.Transaction,
  ): Promise<User> {
    try {
      const db = trx || this.db;
      const user = await db('users as usr')
        .select('usr.id_user', 'usr.email', 'ud.session')
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
        origin: 'UserDB.getUser',
        message: err.message,
        data: { email, session },
      });
      return null;
    }
  }

  async insertUser(newUser: User, trx?: Knex.Transaction): Promise<User> {
    try {
      const db = trx || this.db;
      const { email, external_id } = newUser;
      const [created] = await db('users')
        .insert({
          email,
          password: '',
          external_id: external_id || crypto.randomUUID(),
        })
        .returning('*');
      return created;
    } catch (err) {
      this._logger.log({
        origin: 'UserDB.insertUser',
        message: err.message,
        data: { newUser },
      });
      return null;
    }
  }

  async insertDevice(
    userSession: UserSession,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      const db = trx || this.db;
      const { session, user_id } = userSession;
      const [device] = await db('user_devices')
        .insert({
          user_id,
          session,
          device_os: 'ios',
        })
        .returning('id_user_device');
      return device?.id_user_device ?? device;
    } catch (err) {
      this._logger.log({
        origin: 'UserDB.insertDevice',
        message: err.message,
        data: { userSession },
      });
      return null;
    }
  }

  async getUserByExternalId(
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
        origin: 'UserDB.getUserByExternalId',
        message: err.message,
        data: { external_ids },
      });
      return null;
    }
  }

  async softDeleteUserDevices(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('user_devices')
      .update({ updated_at: db.fn.now(), active: false })
      .where({ active: true, user_id });
  }

  async softDeleteUser(user_id: number, trx?: Knex.Transaction): Promise<void> {
    const db = trx || this.db;
    await db('users')
      .update({ updated_at: db.fn.now(), active: false })
      .where({ active: true, id_user: user_id });
  }

  async softDeleteAuthMethods(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('auth_methods')
      .update({ updated_at: db.fn.now(), active: false })
      .where({ active: true, user_id });
  }

  async getClientID(
    params: { origin: string },
    trx?: Knex.Transaction,
  ): Promise<{ apple_id: string; app_version: string }> {
    try {
      const db = trx || this.db;
      const client = await db('apple_clients')
        .where({ active: true, origin: params.origin })
        .select(['apple_id', 'app_version'])
        .first();
      return client;
    } catch (err) {
      this._logger.log({
        origin: 'UserDB.getClientID',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async insertUserEvent(
    params: {
      event_name: UserEventEnum;
      user_id?: number;
      external_id?: string;
      event_data: object;
    },
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      const db = trx || this.db;
      const inserted = await db('user_events')
        .insert(params)
        .returning('id_user_event');
      return inserted[0].id_user_event;
    } catch (err) {
      this._logger.log({
        origin: 'UserDB.insertUserEvent',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getLastUserEvent(
    params: {
      event_name: UserEventEnum;
      user_id?: number;
      external_id?: string;
    },
    trx?: Knex.Transaction,
  ): Promise<UserEvent> {
    try {
      const db = trx || this.db;
      const filter: {
        event_name?: UserEventEnum;
        user_id?: number;
        external_id?: string;
      } = {};
      if (params.user_id) filter.user_id = params.user_id;
      if (params.external_id) filter.external_id = params.external_id;
      filter.event_name = params.event_name;
      const event = await db('user_events')
        .where(filter)
        .orderBy('created_at', 'desc')
        .first();
      return event;
    } catch (err) {
      this._logger.log({
        origin: 'UserDB.getLastUserEvent',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getUserEventCount(
    params: {
      event_name: UserEventEnum;
      user_id?: number;
      external_id?: string;
    },
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      const db = trx || this.db;
      const filter: {
        event_name?: UserEventEnum;
        user_id?: number;
        external_id?: string;
      } = {};
      if (params.user_id) filter.user_id = params.user_id;
      if (params.external_id) filter.external_id = params.external_id;
      filter.event_name = params.event_name;
      const total_count = await db('user_events').where(filter).count();
      return Number(total_count[0]['count']);
    } catch (err) {
      this._logger.log({
        origin: 'UserDB.getUserEventCount',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getSecondOnboarding(
    params: { onboarding_name: string },
    trx?: Knex.Transaction,
  ): Promise<{ [k: string]: object }> {
    try {
      const db = trx || this.db;
      const response = await db
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
        origin: 'UserDB.getSecondOnboarding',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async getAuthMethodByExternalId(
    params: { auth_type: string; external_id: string },
    trx?: Knex.Transaction,
  ): Promise<{ user_id: number; id_auth_method: number; email: string } | null> {
    try {
      const db = trx || this.db;
      const authMethod = await db('auth_methods as am')
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
        origin: 'UserDB.getAuthMethodByExternalId',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }

  async insertAuthMethod(
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
      if (err.code === '23505') {
        this._logger.log({
          origin: 'UserDB.insertAuthMethod',
          message: 'Duplicate auth method attempted',
          data: { params },
        });
        return null;
      }
      this._logger.log({
        origin: 'UserDB.insertAuthMethod',
        message: err.message,
        data: { params },
      });
      return null;
    }
  }
}
