import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { ExternalResource } from '../../types/user';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
  createTestExternalResource,
} from '../setup';

// `providerName` = storage provider (e.g. "dropbox"); `providerId` = the
// resource's id within that provider (its file id).
function makeResource(overrides: Partial<ExternalResource> = {}): ExternalResource {
  return {
    providerName: 'dropbox',
    providerId: 'id:file-123',
    syncStatus: 'pending',
    lastSyncedAt: null,
    processedFile: false,
    hostId: null,
    ...overrides,
  };
}

describe('LibraryService — external resource flows', () => {
  let service: LibraryService;

  beforeEach(() => {
    service = new LibraryService();
    // Route the service's own this.db.transaction() through the test trx so its
    // nested commit/rollback only releases a savepoint; afterEach rolls back the
    // outer transaction and discards everything.
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('putExternalResource', () => {
    it('inserts a new resource and returns it in the camelCase wire shape', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const uuid = '11111111-1111-1111-1111-111111111111';
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        uuid,
      });

      const resource = makeResource({ providerId: 'id:new-file' });
      const result = await service.putExternalResource(
        user as any,
        uuid,
        resource,
      );

      expect(result.providerId).toBe('id:new-file');
      expect(result.providerName).toBe('dropbox');

      const row = await trx('external_resources')
        .where({ library_item_id: item.id_library_item })
        .first();
      expect(row.provider_id).toBe('id:new-file');
      expect(row.provider_name).toBe('dropbox');
    });

    it('is idempotent: an existing (item, provider, providerId) is not duplicated', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const uuid = '22222222-2222-2222-2222-222222222222';
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        uuid,
      });
      await createTestExternalResource(trx, {
        library_item_id: item.id_library_item,
        provider_name: 'dropbox',
        provider_id: 'id:dup-file',
      });

      const result = await service.putExternalResource(
        user as any,
        uuid,
        makeResource({ providerId: 'id:dup-file' }),
      );

      expect(result.providerId).toBe('id:dup-file');

      const count = await trx('external_resources')
        .where({ library_item_id: item.id_library_item, provider_id: 'id:dup-file' })
        .count<{ count: string }[]>('* as count');
      expect(parseInt(count[0].count)).toBe(1);
    });

    it('throws when the library item is not found', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await expect(
        service.putExternalResource(
          user as any,
          '33333333-3333-3333-3333-333333333333',
          makeResource(),
        ),
      ).rejects.toThrow();
    });
  });

  describe('deleteExternalResource', () => {
    it('soft-deletes the resource and returns it in the camelCase wire shape', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const uuid = '77777777-7777-7777-7777-777777777777';
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        uuid,
      });
      await createTestExternalResource(trx, {
        library_item_id: item.id_library_item,
        provider_name: 'dropbox',
        provider_id: 'id:del-file',
      });

      const result = await service.deleteExternalResource(
        user as any,
        uuid,
        'id:del-file',
        'dropbox',
      );

      expect(result.providerId).toBe('id:del-file');
      expect(result.providerName).toBe('dropbox');

      const row = await trx('external_resources')
        .where({ library_item_id: item.id_library_item, provider_id: 'id:del-file' })
        .first();
      expect(row.active).toBe(false);
    });

    it('throws when the library item is not found', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await expect(
        service.deleteExternalResource(
          user as any,
          '88888888-8888-8888-8888-888888888888',
          'id:whatever',
          'dropbox',
        ),
      ).rejects.toThrow();
    });

    it('throws when the resource does not exist on the item', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const uuid = '99999999-9999-9999-9999-999999999999';
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        uuid,
      });

      await expect(
        service.deleteExternalResource(user as any, uuid, 'id:absent', 'dropbox'),
      ).rejects.toThrow();
    });
  });
});
