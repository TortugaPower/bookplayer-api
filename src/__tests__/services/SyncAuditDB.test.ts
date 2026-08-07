import { describe, it, expect, beforeEach } from '@jest/globals';
import { SyncAuditDB } from '../../services/db/SyncAuditDB';
import {
  SyncOperationJobType,
  SyncOperationRecord,
} from '../../types/syncOperation';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
} from '../setup';

describe('SyncAuditDB', () => {
  let db: SyncAuditDB;

  beforeEach(() => {
    db = new SyncAuditDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const baseOp = (user_id: number): SyncOperationRecord => ({
    user_id,
    job_type: SyncOperationJobType.UPLOAD_ARTWORK,
    http_method: 'POST',
    route: '/thumbnail_set',
    item_uuid: null,
    relative_path: 'David Baldacci - Zero Day',
    params: { relativePath: 'David Baldacci - Zero Day' },
    status_code: 200,
    outcome: 'applied',
    error_message: null,
    app_version: '2023-10-29',
  });

  describe('record', () => {
    it('inserts an applied operation as a distinct row', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.record({ ...baseOp(user.id_user) });
      await db.record({ ...baseOp(user.id_user) });

      const rows = await trx('sync_operations').where({ user_id: user.id_user });
      // applied rows never coalesce -> two distinct rows
      expect(rows).toHaveLength(2);
      expect(rows[0].outcome).toBe('applied');
      expect(rows[0].fingerprint).toBeNull();
      expect(rows[0].occurrence_count).toBe(1);
    });

    it('coalesces repeated identical errors into one row with an incrementing count', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const errorOp = {
        ...baseOp(user.id_user),
        outcome: 'error' as const,
        status_code: 400,
        error_message: 'Item not exists',
      };

      await db.record(errorOp);
      await db.record({ ...errorOp, status_code: 400 });
      await db.record({ ...errorOp });

      const rows = await trx('sync_operations').where({ user_id: user.id_user });
      expect(rows).toHaveLength(1);
      expect(rows[0].occurrence_count).toBe(3);
      expect(rows[0].outcome).toBe('error');
      expect(rows[0].error_message).toBe('Item not exists');
      expect(rows[0].fingerprint).not.toBeNull();
      // first_seen stays at the first occurrence; last_seen advances
      expect(new Date(rows[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[0].first_seen_at).getTime(),
      );
    });

    it('keeps genuinely different errors as separate rows', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const errorOp = {
        ...baseOp(user.id_user),
        outcome: 'error' as const,
        status_code: 400,
        error_message: 'Item not exists',
      };

      await db.record(errorOp);
      // different error_message -> different fingerprint
      await db.record({ ...errorOp, error_message: 'Duplicate key' });
      // different item -> different fingerprint
      await db.record({ ...errorOp, relative_path: 'Zero Day - David Baldacci' });

      const rows = await trx('sync_operations').where({ user_id: user.id_user });
      expect(rows).toHaveLength(3);
      rows.forEach((r) => expect(r.occurrence_count).toBe(1));
    });

    it('does not coalesce an error against an applied row of the same shape', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.record({ ...baseOp(user.id_user) }); // applied, fingerprint null
      await db.record({
        ...baseOp(user.id_user),
        outcome: 'error' as const,
        status_code: 500,
        error_message: 'boom',
      });

      const rows = await trx('sync_operations').where({ user_id: user.id_user });
      expect(rows).toHaveLength(2);
    });

    it('persists params as jsonb', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.record({
        ...baseOp(user.id_user),
        params: { relativePath: 'x', nested: { a: 1 } },
      });

      const row = await trx('sync_operations')
        .where({ user_id: user.id_user })
        .first();
      expect(row.params).toEqual({ relativePath: 'x', nested: { a: 1 } });
    });

    it('never throws on a bad write (fire-and-forget); logs instead', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      // A too-long job_type violates varchar(40) -> insert errors, but record()
      // must swallow it so the sync request is never affected.
      await expect(
        db.record({ ...baseOp(user.id_user), job_type: 'x'.repeat(60) }),
      ).resolves.toBeUndefined();
      expect(mockLoggerService.log).toHaveBeenCalled();
    });
  });

  describe('recentForUser', () => {
    it('returns a user’s operations newest-first and does not leak across users', async () => {
      const trx = getTestTransaction();
      const userA = await createTestUser(trx, { email: 'a@example.com' });
      const userB = await createTestUser(trx, { email: 'b@example.com' });

      await db.record({ ...baseOp(userA.id_user), route: '/' });
      await db.record({ ...baseOp(userA.id_user), route: '/move' });
      await db.record({ ...baseOp(userB.id_user), route: '/rename' });

      const rowsA = await db.recentForUser(userA.id_user, 10);
      expect(rowsA).toHaveLength(2);
      expect(rowsA!.every((r: any) => r.user_id === userA.id_user)).toBe(true);
      // newest-first
      expect(new Date(rowsA![0].occurred_at).getTime()).toBeGreaterThanOrEqual(
        new Date(rowsA![1].occurred_at).getTime(),
      );
    });
  });

  describe('purgeOlderThan', () => {
    it('deletes rows untouched beyond the window but keeps recently-seen ones', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.record({ ...baseOp(user.id_user), route: '/recent' });
      // Backdate one row's last_seen_at past the retention window.
      const [stale] = await trx('sync_operations')
        .insert({
          user_id: user.id_user,
          job_type: SyncOperationJobType.UPLOAD,
          http_method: 'PUT',
          route: '/',
          outcome: 'applied',
          occurred_at: trx.raw("now() - interval '200 days'"),
          first_seen_at: trx.raw("now() - interval '200 days'"),
          last_seen_at: trx.raw("now() - interval '200 days'"),
          occurrence_count: 1,
        })
        .returning('id');

      const removed = await db.purgeOlderThan(90);
      expect(removed).toBe(1);

      const remaining = await trx('sync_operations').where({
        user_id: user.id_user,
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].route).toBe('/recent');
      expect(String(remaining[0].id)).not.toBe(String(stale.id));
    });
  });
});
