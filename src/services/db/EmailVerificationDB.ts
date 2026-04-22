import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';

export interface VerificationCodeRecord {
  id: number;
  email: string;
  code: string;
  expires_at: Date;
  verified: boolean;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

export class EmailVerificationDB {
  private readonly _logger = logger;
  private db = database;

  async countRecentCodes(
    email: string,
    since: Date,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      const db = trx || this.db;
      const row = await db('email_verification_codes')
        .where('email', email)
        .where('created_at', '>', since)
        .count('id as count')
        .first();
      return parseInt((row?.count as string) ?? '0', 10);
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.countRecentCodes',
        message: err.message,
        data: { email },
      });
      return 0;
    }
  }

  async invalidateUnverified(email: string, trx?: Knex.Transaction): Promise<void> {
    try {
      const db = trx || this.db;
      await db('email_verification_codes')
        .where('email', email)
        .where('verified', false)
        .del();
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.invalidateUnverified',
        message: err.message,
        data: { email },
      });
    }
  }

  async insertCode(
    params: { email: string; code: string; expires_at: Date },
    trx?: Knex.Transaction,
  ): Promise<void> {
    try {
      const db = trx || this.db;
      await db('email_verification_codes').insert({
        email: params.email,
        code: params.code,
        expires_at: params.expires_at,
        verified: false,
        attempts: 0,
      });
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.insertCode',
        message: err.message,
        data: { email: params.email },
      });
    }
  }

  async findLatestUnexpired(
    email: string,
    trx?: Knex.Transaction,
  ): Promise<VerificationCodeRecord | null> {
    try {
      const db = trx || this.db;
      const record = await db('email_verification_codes')
        .where('email', email)
        .where('verified', false)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .first();
      return record || null;
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.findLatestUnexpired',
        message: err.message,
        data: { email },
      });
      return null;
    }
  }

  async incrementAttempts(id: number, trx?: Knex.Transaction): Promise<void> {
    try {
      const db = trx || this.db;
      await db('email_verification_codes').where('id', id).increment('attempts', 1);
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.incrementAttempts',
        message: err.message,
        data: { id },
      });
    }
  }

  async deleteCode(id: number, trx?: Knex.Transaction): Promise<void> {
    try {
      const db = trx || this.db;
      await db('email_verification_codes').where('id', id).del();
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.deleteCode',
        message: err.message,
        data: { id },
      });
    }
  }

  async markVerified(id: number, trx?: Knex.Transaction): Promise<void> {
    try {
      const db = trx || this.db;
      await db('email_verification_codes').where('id', id).update({
        verified: true,
        updated_at: new Date(),
      });
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.markVerified',
        message: err.message,
        data: { id },
      });
    }
  }

  async deleteExpired(trx?: Knex.Transaction): Promise<number> {
    try {
      const db = trx || this.db;
      return await db('email_verification_codes')
        .where('expires_at', '<', new Date())
        .del();
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationDB.deleteExpired',
        message: err.message,
      });
      return 0;
    }
  }
}
