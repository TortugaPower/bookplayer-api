import { Knex } from 'knex';
import moment from 'moment';
import database from '../../database';
import { logger } from '../LoggerService';
import type {
  AuthMethod,
  PasskeyCredential,
  PasskeyInfo,
  UserWithExternalId,
} from '../../types/passkey';

export class PasskeyDB {
  private readonly _logger = logger;
  private db = database;

  // Challenges

  async storeChallenge(
    params: {
      challenge: Buffer;
      user_id?: number;
      email?: string;
      challenge_type: 'registration' | 'authentication';
      ttlSeconds: number;
    },
    trx?: Knex.Transaction,
  ): Promise<number> {
    const db = trx || this.db;
    const expiresAt = moment().add(params.ttlSeconds, 'seconds').toDate();
    const [result] = await db('webauthn_challenges')
      .insert({
        challenge: params.challenge,
        user_id: params.user_id || null,
        email: params.email || null,
        challenge_type: params.challenge_type,
        expires_at: expiresAt,
      })
      .returning('id_challenge');
    return result.id_challenge;
  }

  async getChallengeByValue(
    challengeBase64: string,
    trx?: Knex.Transaction,
  ): Promise<{
    id_challenge: number;
    challenge: Buffer;
    user_id: number | null;
    email: string | null;
    challenge_type: 'registration' | 'authentication';
  } | null> {
    try {
      const db = trx || this.db;
      const challengeBuffer = Buffer.from(challengeBase64, 'base64url');
      const challenge = await db('webauthn_challenges')
        .where({ challenge: challengeBuffer })
        .andWhere('expires_at', '>', new Date())
        .first();
      return challenge || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getChallengeByValue',
        message: err.message,
        data: { challengeBase64 },
      });
      return null;
    }
  }

  async deleteChallenge(
    id_challenge: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('webauthn_challenges').where({ id_challenge }).del();
  }

  // Passkey credentials

  async getUserPasskeys(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<PasskeyInfo[]> {
    try {
      const db = trx || this.db;
      const passkeys = await db('passkey_credentials as pc')
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
        origin: 'PasskeyDB.getUserPasskeys',
        message: err.message,
        data: { user_id },
      });
      return [];
    }
  }

  async getUserPasskeyCredentials(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<PasskeyCredential[]> {
    try {
      const db = trx || this.db;
      const passkeys = await db('passkey_credentials as pc')
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
        origin: 'PasskeyDB.getUserPasskeyCredentials',
        message: err.message,
        data: { user_id },
      });
      return [];
    }
  }

  async getPasskeyByCredentialId(
    credential_id: Buffer,
    trx?: Knex.Transaction,
  ): Promise<PasskeyCredential | null> {
    try {
      const db = trx || this.db;
      const passkey = await db('passkey_credentials')
        .where({ credential_id, active: true })
        .first();
      return passkey || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getPasskeyByCredentialId',
        message: err.message,
        data: { credential_id: credential_id.toString('base64url') },
      });
      return null;
    }
  }

  async getPasskeyWithAuthMethod(
    params: { user_id: number; passkey_id: number },
    trx?: Knex.Transaction,
  ): Promise<
    (PasskeyCredential & { auth_method_id: number }) | null
  > {
    try {
      const db = trx || this.db;
      const passkey = await db('passkey_credentials as pc')
        .join('auth_methods as am', 'am.id_auth_method', 'pc.auth_method_id')
        .where({
          'pc.id_passkey': params.passkey_id,
          'am.user_id': params.user_id,
          'pc.active': true,
        })
        .first();
      return passkey || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getPasskeyWithAuthMethod',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async insertPasskeyCredential(
    params: {
      auth_method_id: number;
      credential_id: Buffer;
      public_key: Buffer;
      counter: number;
      device_type: string;
      backed_up: boolean;
      transports?: string[];
      device_name?: string;
    },
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('passkey_credentials').insert({
      auth_method_id: params.auth_method_id,
      credential_id: params.credential_id,
      public_key: params.public_key,
      counter: params.counter,
      device_type: params.device_type,
      backed_up: params.backed_up,
      transports: params.transports ?? [],
      device_name: params.device_name ?? null,
    });
  }

  async updatePasskeyCounter(
    params: { id_passkey: number; counter: number },
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('passkey_credentials')
      .where({ id_passkey: params.id_passkey })
      .update({
        counter: params.counter,
        last_used_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
  }

  async softDeletePasskey(
    id_passkey: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('passkey_credentials')
      .where({ id_passkey })
      .update({ active: false, updated_at: db.fn.now() });
  }

  async softDeleteAuthMethod(
    id_auth_method: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('auth_methods')
      .where({ id_auth_method })
      .update({ active: false, updated_at: db.fn.now() });
  }

  async updatePasskeyDeviceName(
    params: { id_passkey: number; device_name: string },
    trx?: Knex.Transaction,
  ): Promise<void> {
    const db = trx || this.db;
    await db('passkey_credentials')
      .where({ id_passkey: params.id_passkey })
      .update({
        device_name: params.device_name,
        updated_at: db.fn.now(),
      });
  }

  // Auth methods

  async getUserAuthMethods(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<AuthMethod[]> {
    try {
      const db = trx || this.db;
      const authMethods = await db('auth_methods')
        .where({ user_id, active: true })
        .orderBy('created_at', 'asc');
      return authMethods;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getUserAuthMethods',
        message: err.message,
        data: { user_id },
      });
      return [];
    }
  }

  async getAuthMethodCount(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      const db = trx || this.db;
      const result = await db('auth_methods')
        .where({ user_id, active: true })
        .count('id_auth_method as count')
        .first();
      return parseInt(result?.count as string, 10) || 0;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getAuthMethodCount',
        message: err.message,
        data: { user_id },
      });
      return 0;
    }
  }

  async getAppleAuthMethod(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<{ external_id: string } | null> {
    try {
      const db = trx || this.db;
      const authMethod = await db('auth_methods')
        .where({ user_id, auth_type: 'apple', active: true })
        .first();
      return authMethod || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getAppleAuthMethod',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  // User lookup (joins across users + auth_methods + passkey_credentials)

  async getUserByEmail(
    email: string,
    trx?: Knex.Transaction,
  ): Promise<UserWithExternalId | null> {
    try {
      const db = trx || this.db;
      const user = await db('users')
        .where({ email, active: true })
        .select('id_user', 'email', 'external_id', 'active')
        .first();
      return user || null;
    } catch (err) {
      this._logger.log({
        origin: 'PasskeyDB.getUserByEmail',
        message: err.message,
        data: { email },
      });
      return null;
    }
  }

  async getUserByCredentialId(
    credential_id: Buffer,
    trx?: Knex.Transaction,
  ): Promise<UserWithExternalId | null> {
    try {
      const db = trx || this.db;
      const user = await db('users as u')
        .select('u.id_user', 'u.email', 'u.external_id', 'u.active')
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
        origin: 'PasskeyDB.getUserByCredentialId',
        message: err.message,
        data: { credential_id: credential_id.toString('base64url') },
      });
      return null;
    }
  }

}
