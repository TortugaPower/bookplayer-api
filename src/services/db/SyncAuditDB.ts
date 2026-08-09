import crypto from 'crypto';
import database from '../../database';
import { logger } from '../LoggerService';
import { SyncOperationRecord } from '../../types/syncOperation';

export class SyncAuditDB {
  private readonly _logger = logger;
  private db = database;

  /**
   * Append a sync operation.
   *
   * Errors are coalesced: repeated identical failures (same user + fingerprint)
   * collapse into a single row with an incrementing `occurrence_count`, so a
   * client stuck retrying the same failing op every 5s doesn't balloon the
   * table. `applied` rows are always distinct inserts — successful mutations are
   * never retried by the client.
   *
   * Fire-and-forget: never throws. A logging failure must not affect the sync
   * request that triggered it.
   */
  async record(op: SyncOperationRecord): Promise<void> {
    try {
      const isError = op.outcome === 'error';
      const fingerprint = isError ? this.fingerprint(op) : null;

      const bindings = {
        user_id: op.user_id,
        job_type: op.job_type,
        http_method: op.http_method,
        route: op.route,
        item_uuid: op.item_uuid ?? null,
        relative_path: op.relative_path ?? null,
        params: op.params != null ? JSON.stringify(op.params) : null,
        status_code: op.status_code ?? null,
        outcome: op.outcome,
        error_message: op.error_message ?? null,
        app_version: op.app_version ?? null,
        fingerprint,
      };

      // A partial unique index can only be used as an ON CONFLICT arbiter when
      // its predicate is restated here, which knex's .onConflict() can't emit —
      // hence raw. 'applied' rows never satisfy the predicate, so this single
      // statement handles both paths: coalesce errors, plain-insert successes.
      await this.db.raw(
        `INSERT INTO sync_operations
           (user_id, occurred_at, job_type, http_method, route, item_uuid,
            relative_path, params, status_code, outcome, error_message,
            app_version, fingerprint,
            first_seen_at, last_seen_at, occurrence_count)
         VALUES
           (:user_id, now(), :job_type, :http_method, :route, :item_uuid,
            :relative_path, cast(:params as jsonb), :status_code, :outcome,
            :error_message, :app_version, :fingerprint,
            now(), now(), 1)
         ON CONFLICT (user_id, fingerprint) WHERE outcome = 'error'
         DO UPDATE SET occurrence_count = sync_operations.occurrence_count + 1,
                       last_seen_at     = now(),
                       status_code      = EXCLUDED.status_code,
                       error_message    = EXCLUDED.error_message,
                       app_version      = EXCLUDED.app_version`,
        bindings,
      );
    } catch (err) {
      this._logger.log({
        origin: 'SyncAuditDB.record',
        message: err.message,
        data: { user_id: op?.user_id, job_type: op?.job_type },
      });
    }
  }

  /** Most recent operations for a user, newest first — for support/forensics. */
  async recentForUser(user_id: number, limit = 100) {
    try {
      return await this.db('sync_operations')
        .where({ user_id })
        .orderBy('occurred_at', 'desc')
        .limit(limit);
    } catch (err) {
      this._logger.log({
        origin: 'SyncAuditDB.recentForUser',
        message: err.message,
        data: { user_id },
      });
      return null;
    }
  }

  private fingerprint(op: SyncOperationRecord): string {
    return crypto
      .createHash('md5')
      .update(
        [
          op.job_type,
          op.item_uuid ?? '',
          op.relative_path ?? '',
          op.error_message ?? '',
        ].join(':'),
      )
      .digest('hex');
  }
}
