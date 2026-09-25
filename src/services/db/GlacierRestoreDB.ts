import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';

export type RestoreRequestKind = 'object' | 'thumbnail';
export type RestoreRequestState = 'requested' | 'finalized' | 'failed' | 'archived';

export interface GlacierRestoreRequestDB {
  id_glacier_restore_request: number;
  user_id: number;
  library_item_id: number | null;
  kind: RestoreRequestKind;
  key: string;
  tier: string;
  days: number;
  state: RestoreRequestState;
  attempts: number;
  requested_at: Date;
  finalized_at: Date | null;
  last_error: string | null;
}

/** Owns `glacier_restore_requests`: what the on-demand hook asked S3 to thaw, for the Lambda to finalize. */
export class GlacierRestoreDB {
  private readonly _logger = logger;
  private db = database;

  /**
   * Records that `key` is thawing. One row per (user, key): a finalized or
   * failed row is re-opened instead of duplicated. When `issued` is true this
   * call sent the RestoreObject, so `requested_at` and `attempts` move even on
   * a row still `requested` — a copy whose window closed before it was
   * finalized reads as a fresh request, not the stale one. When false (the
   * object was already thawing) a `requested` row is left alone, so repeated
   * taps while a book thaws are idempotent. `null` means the write failed
   * (logged), not "already there".
   */
  async upsertRequested(
    params: {
      user_id: number;
      library_item_id: number | null;
      kind: RestoreRequestKind;
      key: string;
      tier: string;
      days: number;
      issued: boolean;
    },
    trx?: Knex.Transaction,
  ): Promise<boolean | null> {
    try {
      const db = trx || this.db;
      const guard = params.issued ? '' : `where glacier_restore_requests.state <> 'requested'`;
      await db.raw(
        `
        insert into glacier_restore_requests
          (user_id, library_item_id, kind, key, tier, days, state, attempts, requested_at, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, 'requested', 1, now(), now(), now())
        on conflict (user_id, key) do update
          set state = 'requested',
              requested_at = now(),
              attempts = glacier_restore_requests.attempts + 1,
              library_item_id = coalesce(excluded.library_item_id, glacier_restore_requests.library_item_id),
              tier = excluded.tier,
              days = excluded.days,
              finalized_at = null,
              last_error = null,
              updated_at = now()
          ${guard}
        `,
        [params.user_id, params.library_item_id, params.kind, params.key, params.tier, params.days],
      );
      return true;
    } catch (err) {
      this._logger.log(
        {
          origin: 'GlacierRestoreDB.upsertRequested',
          message: err.message,
          data: { user_id: params.user_id, kind: params.kind },
        },
        'warn',
      );
      return null;
    }
  }

  async getByUser(user_id: number, trx?: Knex.Transaction): Promise<GlacierRestoreRequestDB[] | null> {
    try {
      const db = trx || this.db;
      return await db('glacier_restore_requests').where({ user_id }).orderBy('key');
    } catch (err) {
      this._logger.log(
        { origin: 'GlacierRestoreDB.getByUser', message: err.message, data: { user_id } },
        'warn',
      );
      return null;
    }
  }
}
