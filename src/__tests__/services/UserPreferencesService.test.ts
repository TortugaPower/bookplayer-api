import { describe, it, expect, beforeEach } from '@jest/globals';
import { UserPreferencesService } from '../../services/UserPreferencesService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
} from '../setup';

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    service = new UserPreferencesService();
    (service as any)._logger = mockLoggerService;
    (service as any).db = getTestTransaction();
    (service as any)._prefsDB.db = getTestTransaction();
    (service as any)._prefsDB._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('upsertPreferences', () => {
    it('successfully upserts a single valid entry', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
      ]);

      expect(result).toBe(true);
      const stored = await service.getPreferences(user.id_user);
      expect(stored).toHaveLength(1);
      expect(stored![0].value).toEqual({ sort: 'metadataTitle' });
    });

    it('returns true (no-op) for an empty entries array', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.upsertPreferences(user.id_user, []);

      expect(result).toBe(true);
      const stored = await service.getPreferences(user.id_user);
      expect(stored).toEqual([]);
    });

    it('returns null when entries is not an array', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.upsertPreferences(
        user.id_user,
        // @ts-expect-error — intentionally passing wrong type
        'not-an-array',
      );

      expect(result).toBeNull();
    });

    it('rejects a batch larger than the 500-entry cap', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const oversized = Array.from({ length: 501 }, (_, i) => ({
        key: `library_sort:folder-${i}`,
        value: { sort: 'metadataTitle' },
      }));

      const result = await service.upsertPreferences(user.id_user, oversized);

      expect(result).toBeNull();
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'rejected: entries exceed limit',
        }),
      );
    });

    it.each([
      ['empty key', ''],
      ['key too long (129 chars)', 'a'.repeat(129)],
      ['contains a slash', 'library_sort/foo'],
      ['contains whitespace', 'library_sort default'],
      ['contains quote', 'library_sort:"foo"'],
    ])('rejects an invalid key (%s)', async (_label, badKey) => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.upsertPreferences(user.id_user, [
        { key: badKey, value: { sort: 'metadataTitle' } },
      ]);

      expect(result).toBeNull();
    });

    it.each([
      ['null value', null],
      ['array value', [1, 2, 3]],
      ['scalar string value', 'metadataTitle'],
      ['scalar number value', 42],
      ['scalar boolean value', true],
    ])('rejects an invalid value (%s)', async (_label, badValue) => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.upsertPreferences(user.id_user, [
        // @ts-expect-error — intentionally passing wrong type
        { key: 'library_sort:default', value: badValue },
      ]);

      expect(result).toBeNull();
    });

    it('rolls back the transaction when one of multiple entries is invalid', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      // First, set a valid baseline.
      await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
      ]);

      // Now mix valid + invalid in one batch — entire batch must reject.
      const result = await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'mostRecent' } },
        { key: 'invalid key with spaces', value: { sort: 'fileName' } },
      ]);

      expect(result).toBeNull();
      const stored = await service.getPreferences(user.id_user);
      expect(stored).toHaveLength(1);
      // Baseline value preserved — the partial-update did not commit.
      expect(stored![0].value).toEqual({ sort: 'metadataTitle' });
    });

    it('accepts the full set of plan-defined sticky-sort key shapes', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
        {
          key: 'library_sort:550e8400-e29b-41d4-a716-446655440000',
          value: { sort: 'mostRecent' },
        },
      ]);

      expect(result).toBe(true);
    });
  });

  describe('getPreferences', () => {
    it('returns an empty array for a user with no preferences', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.getPreferences(user.id_user);

      expect(result).toEqual([]);
    });

    it('honors the prefix filter', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
        { key: 'theme:variant', value: { name: 'dark' } },
      ]);

      const result = await service.getPreferences(user.id_user, 'library_sort:');

      expect(result).toHaveLength(1);
      expect(result![0].key).toBe('library_sort:default');
    });

    it('does not return another user’s preferences', async () => {
      const trx = getTestTransaction();
      const userA = await createTestUser(trx, { email: 'a@example.com' });
      const userB = await createTestUser(trx, { email: 'b@example.com' });

      await service.upsertPreferences(userA.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
      ]);
      await service.upsertPreferences(userB.id_user, [
        { key: 'library_sort:default', value: { sort: 'mostRecent' } },
      ]);

      const aResult = await service.getPreferences(userA.id_user);

      expect(aResult).toHaveLength(1);
      expect(aResult![0].value).toEqual({ sort: 'metadataTitle' });
    });
  });

  describe('deletePreferences', () => {
    it('soft-deletes the specified keys', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
        { key: 'library_sort:keep', value: { sort: 'fileName' } },
      ]);

      const result = await service.deletePreferences(user.id_user, [
        'library_sort:default',
      ]);

      expect(result).toBe(true);
      const remaining = await service.getPreferences(user.id_user);
      expect(remaining).toHaveLength(1);
      expect(remaining![0].key).toBe('library_sort:keep');
    });

    it('returns true (no-op) for an empty keys array', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.deletePreferences(user.id_user, []);

      expect(result).toBe(true);
    });

    it('returns null when keys is not an array', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.deletePreferences(
        user.id_user,
        // @ts-expect-error — intentionally passing wrong type
        'library_sort:default',
      );

      expect(result).toBeNull();
    });

    it('rejects when any key in the batch is invalid', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const result = await service.deletePreferences(user.id_user, [
        'library_sort:default',
        'invalid key with spaces',
      ]);

      expect(result).toBeNull();
    });

    it('lets a previously soft-deleted key be re-set, reactivating the row', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'metadataTitle' } },
      ]);
      await service.deletePreferences(user.id_user, ['library_sort:default']);

      // After soft-delete, GET excludes the row.
      let stored = await service.getPreferences(user.id_user);
      expect(stored).toEqual([]);

      // Re-setting the same key brings it back with the new value.
      await service.upsertPreferences(user.id_user, [
        { key: 'library_sort:default', value: { sort: 'fileName' } },
      ]);

      stored = await service.getPreferences(user.id_user);
      expect(stored).toHaveLength(1);
      expect(stored![0].value).toEqual({ sort: 'fileName' });
    });
  });
});
