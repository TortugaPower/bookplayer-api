import { describe, it, expect, beforeEach } from '@jest/globals';
import { UserPreferencesDB } from '../../services/db/UserPreferencesDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
} from '../setup';

describe('UserPreferencesDB', () => {
  let db: UserPreferencesDB;

  beforeEach(() => {
    db = new UserPreferencesDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('getAllByUserId', () => {
    it('returns an empty array when user has no preferences', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await db.getAllByUserId(user.id_user, undefined, trx);

      expect(result).toEqual([]);
    });

    it('returns only the requesting user’s preferences (no cross-user leak)', async () => {
      const trx = getTestTransaction();
      const userA = await createTestUser(trx, { email: 'a@example.com' });
      const userB = await createTestUser(trx, { email: 'b@example.com' });

      await db.upsertMany(
        userA.id_user,
        [{ key: 'library_sort:default', value: { sort: 'metadataTitle' } }],
        trx,
      );
      await db.upsertMany(
        userB.id_user,
        [{ key: 'library_sort:default', value: { sort: 'mostRecent' } }],
        trx,
      );

      const result = await db.getAllByUserId(userA.id_user, undefined, trx);

      expect(result).toHaveLength(1);
      expect(result![0].key).toBe('library_sort:default');
      expect(result![0].value).toEqual({ sort: 'metadataTitle' });
    });

    it('filters by key prefix when provided', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.upsertMany(
        user.id_user,
        [
          { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
          { key: 'library_sort:abc-uuid', value: { sort: 'mostRecent' } },
          { key: 'theme:variant', value: { name: 'dark' } },
        ],
        trx,
      );

      const filtered = await db.getAllByUserId(user.id_user, 'library_sort:', trx);

      expect(filtered).toHaveLength(2);
      const keys = filtered!.map((row) => row.key).sort();
      expect(keys).toEqual(['library_sort:abc-uuid', 'library_sort:default']);
    });

    it('excludes soft-deleted rows', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.upsertMany(
        user.id_user,
        [
          { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
          { key: 'library_sort:keep-me', value: { sort: 'fileName' } },
        ],
        trx,
      );

      await db.softDeleteKeys(user.id_user, ['library_sort:default'], trx);

      const result = await db.getAllByUserId(user.id_user, undefined, trx);

      expect(result).toHaveLength(1);
      expect(result![0].key).toBe('library_sort:keep-me');
    });

    it('returns rows ordered by key', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.upsertMany(
        user.id_user,
        [
          { key: 'library_sort:zzz', value: { sort: 'metadataTitle' } },
          { key: 'library_sort:aaa', value: { sort: 'fileName' } },
          { key: 'library_sort:mmm', value: { sort: 'mostRecent' } },
        ],
        trx,
      );

      const result = await db.getAllByUserId(user.id_user, 'library_sort:', trx);

      const keys = result!.map((row) => row.key);
      expect(keys).toEqual([
        'library_sort:aaa',
        'library_sort:mmm',
        'library_sort:zzz',
      ]);
    });
  });

  describe('upsertMany', () => {
    it('inserts new rows', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await db.upsertMany(
        user.id_user,
        [
          { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
          { key: 'library_sort:abc', value: { sort: 'fileName' } },
        ],
        trx,
      );

      expect(result).toBe(true);
      const rows = await trx('user_preferences').where({ user_id: user.id_user });
      expect(rows).toHaveLength(2);
    });

    it('updates the existing row on (user_id, key) conflict', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.upsertMany(
        user.id_user,
        [{ key: 'library_sort:default', value: { sort: 'metadataTitle' } }],
        trx,
      );
      await db.upsertMany(
        user.id_user,
        [{ key: 'library_sort:default', value: { sort: 'mostRecent' } }],
        trx,
      );

      const rows = await trx('user_preferences')
        .where({ user_id: user.id_user, key: 'library_sort:default' })
        .select('value');
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toEqual({ sort: 'mostRecent' });
    });

    it('reactivates a soft-deleted row when re-set', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.upsertMany(
        user.id_user,
        [{ key: 'library_sort:default', value: { sort: 'metadataTitle' } }],
        trx,
      );
      await db.softDeleteKeys(user.id_user, ['library_sort:default'], trx);
      await db.upsertMany(
        user.id_user,
        [{ key: 'library_sort:default', value: { sort: 'fileName' } }],
        trx,
      );

      const rows = await trx('user_preferences')
        .where({ user_id: user.id_user, key: 'library_sort:default' });
      expect(rows).toHaveLength(1);
      expect(rows[0].active).toBe(true);
      expect(rows[0].value).toEqual({ sort: 'fileName' });
    });

    it('stores nested JSON objects in the value column', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const nested = { sort: 'metadataTitle', meta: { source: 'iOS', version: 5 } };

      await db.upsertMany(
        user.id_user,
        [{ key: 'library_sort:default', value: nested }],
        trx,
      );

      const row = (await db.getAllByUserId(user.id_user, undefined, trx))![0];
      expect(row.value).toEqual(nested);
    });
  });

  describe('softDeleteKeys', () => {
    it('marks rows inactive but does not physically delete them', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await db.upsertMany(
        user.id_user,
        [
          { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
          { key: 'library_sort:keep', value: { sort: 'fileName' } },
        ],
        trx,
      );
      await db.softDeleteKeys(user.id_user, ['library_sort:default'], trx);

      // Public view (active=true filter) excludes the deleted row.
      const visible = await db.getAllByUserId(user.id_user, undefined, trx);
      expect(visible).toHaveLength(1);
      expect(visible![0].key).toBe('library_sort:keep');

      // Raw table still has both rows.
      const rawRows = await trx('user_preferences').where({ user_id: user.id_user });
      expect(rawRows).toHaveLength(2);
      const deleted = rawRows.find((r) => r.key === 'library_sort:default');
      expect(deleted!.active).toBe(false);
    });

    it('does not affect other users’ rows', async () => {
      const trx = getTestTransaction();
      const userA = await createTestUser(trx, { email: 'a@example.com' });
      const userB = await createTestUser(trx, { email: 'b@example.com' });

      await db.upsertMany(
        userA.id_user,
        [{ key: 'library_sort:default', value: { sort: 'metadataTitle' } }],
        trx,
      );
      await db.upsertMany(
        userB.id_user,
        [{ key: 'library_sort:default', value: { sort: 'mostRecent' } }],
        trx,
      );

      await db.softDeleteKeys(userA.id_user, ['library_sort:default'], trx);

      const userBRows = await db.getAllByUserId(userB.id_user, undefined, trx);
      expect(userBRows).toHaveLength(1);
      expect(userBRows![0].value).toEqual({ sort: 'mostRecent' });
    });
  });
});
