import { injectable } from 'inversify';
import { AppleJWT, SignApple, TypeUserParams, User, UserSession } from '../types/user';
import verifyAppleToken from 'verify-apple-id-token';
import { Knex } from 'knex';
import database from '../database';
import JWT from 'jsonwebtoken';

@injectable()
export class UserServices {
  private db = database;

  async TokenUser(UserLogged: User): Promise<string> {
    const token = JWT.sign(JSON.stringify(UserLogged), process.env.APP_SECRET);
    return token;
  }

  async verifyToken({ token_id }: SignApple): Promise<AppleJWT> {
    try {
      const decriptJWT = await verifyAppleToken({
        idToken: token_id,
        clientId: process.env.APPLE_CLIENT_ID,
      });
      
      return decriptJWT;
    } catch(err)  {
      console.log(err.message);
      return null;
    }
  }

  async GetUser({ email, session }: UserSession, trx?: Knex.Transaction): Promise<User> {
    try {
      const db = trx || this.db;
      const user = await db('users as usr')
        .select('usr.id_user', 'usr.email', 'up.value as ' + TypeUserParams.subscription, 'ud.session')
        .leftJoin('user_params as up', function() {
          this.on('usr.id_user', '=', 'up.user_id').andOn('up.param', '=', db.raw('?', [TypeUserParams.subscription]))
            .andOn('up.active', '=', db.raw('?', [true]));
        })
        .leftJoin('user_devices as ud', function() {
          this.on('usr.id_user', '=', 'ud.user_id')
            .andOn('ud.session', '=', db.raw('?', [session || '']));
        })
        .where({
          email,
          'usr.active': true,
        }).first();
      return user;
    } catch(err)  {
      console.log(err.message);
      return null;
    }
  }
  async AddNewUser(newUser: User, trx?: Knex.Transaction): Promise<User> {
    try {
      const { email } = newUser;
      const db = trx || this.db;
      const userCreated = await db('users').insert({
        email,
        password: '',
      }).returning('*');
      return userCreated[0];
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async AddNewDevice(userSession: UserSession, trx?: Knex.Transaction): Promise<number> {
    try {
      const { session, user_id } = userSession;
      const db = trx || this.db;
      const deviceCreated = await db('user_devices').insert({
        user_id,
        session,
        device_os: 'ios',
      }).returning('id_user_device');
      return deviceCreated[0];
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }
}
