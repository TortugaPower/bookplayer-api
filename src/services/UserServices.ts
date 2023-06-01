import { injectable } from 'inversify';
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
@injectable()
export class UserServices {
  private db = database;

  async TokenUser(UserLogged: User): Promise<string> {
    const token = JWT.sign(
      JSON.stringify({ ...UserLogged, time: moment().unix() }),
      process.env.APP_SECRET,
    );
    return token;
  }

  async verifyToken({ token_id }: SignApple): Promise<AppleJWT> {
    try {
      const decriptJWT = await verifyAppleToken({
        idToken: token_id,
        clientId: process.env.APPLE_CLIENT_ID,
      });

      return decriptJWT;
    } catch (err) {
      console.log(err.message);
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
      console.log(err.message);
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
      console.log(err.message);
      await tx.rollback();
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
      console.log(err.message);
      return null;
    }
  }

  async GetUserByAppleID(
    apple_id: string,
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
          'user_params.value': apple_id,
          'user_params.param': TypeUserParams.apple_id,
          'user_params.active': true,
        })
        .first()
        .debug(true);
      return user;
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async UpdateSubscription(
    user_id: number,
    subscription: string,
    trx?: Knex.Transaction,
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
      console.log(err.message);
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
      console.log(err.message);
      await tx.rollback();
      return false;
    }
  }

  async getUserSubscriptionState(user_id: number): Promise<string> {
    try {
      const userState = await this.db
        .raw(
          `
        select usr.id_user, usr.email, apple_id.value as apple_id,
          subscription.period_type, subscription.type
        from users usr
        join lateral (
          select * from user_params up where usr.id_user = up.user_id and param='apple_id'
          order by up.id_param desc limit 1
        ) as apple_id on true
        join lateral (
          select * from subscription_events sevent where sevent.original_app_user_id=apple_id.value
          order by sevent.id_subscription_event desc limit 1
        ) as subscription on true
        where usr.id_user=?
      `,
          [user_id],
        )
        .then((res) => res.rows[0]);
      return userState.type;
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }
}
