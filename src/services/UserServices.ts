import { inject, injectable } from 'inversify';
import {
  AppleJWT,
  AppleUser,
  SignApple,
  TypeUserParams,
  User,
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

  async AddNewUser(newUser: User, trx?: Knex.Transaction): Promise<User> {
    const tx = trx || (await this.db.transaction());
    try {
      const { email } = newUser;
      const userCreated = await tx('users')
        .insert({
          email,
          password: '',
        })
        .returning('*');
      if (newUser.params) {
        const paramsRows = Object.keys(newUser.params).reduce(
          (rows, k: keyof UserParamsObject) => {
            return rows.concat([
              {
                param: k,
                value: newUser.params[k],
                user_id: userCreated[0].id_user,
              },
            ]);
          },
          [],
        );
        await tx('user_params').insert(paramsRows).returning('id_param');
      }
      await tx.commit();
      return {
        ...userCreated[0],
        params: newUser.params,
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

  async GetUserByAppleID(
    apple_id: string[],
    trx?: Knex.Transaction,
  ): Promise<AppleUser> {
    try {
      const db = trx || this.db;
      const user = await db('user_params')
        .select(
          'usr.id_user',
          'usr.email',
          'value as ' + TypeUserParams.apple_id,
        )
        .join('users as usr', function () {
          this.on('usr.id_user', '=', 'user_params.user_id').andOn(
            'usr.active',
            '=',
            db.raw('?', [true]),
          );
        })
        .where({
          'user_params.active': true,
        })
        .whereRaw('user_params.param = ? and user_params.value = ANY(?)', [
          TypeUserParams.apple_id,
          apple_id,
        ])
        .first()
        .debug(true);
      return user;
    } catch (err) {
      this._logger.log({
        origin: 'GetUserByAppleID',
        message: err.message,
        data: { apple_id },
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
      const userState = await this.db
        .raw(
          `
        select usr.id_user, usr.email, apple_id.value as apple_id,
          coalesce(subscription_one.period_type, subscription_two.period_type) as period_type,
          coalesce(subscription_one.type, subscription_two.type) as type
        from users usr
        join lateral (
          select * from user_params up where usr.id_user = up.user_id and param='apple_id'
          order by up.id_param desc limit 1
        ) as apple_id on true
        left join lateral (
          select * from subscription_events sevent where sevent.original_app_user_id=apple_id.value
          order by sevent.id_subscription_event desc limit 1
        ) as subscription_one on true
        left join lateral (
          select * from subscription_events sevent where replace((sevent.json -> 'app_user_id')::varchar, '"', '') = apple_id.value
          order by sevent.id_subscription_event desc limit 1
        ) as subscription_two on true
        where usr.id_user=? and coalesce(subscription_one.type, subscription_two.type) is not null
      `,
          [user_id],
        )
        .then((res) => res.rows[0]);
      return userState.type;
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
}
