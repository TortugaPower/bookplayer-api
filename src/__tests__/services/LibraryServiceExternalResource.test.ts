import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { ExternalResource, StorageAction } from '../../types/user';
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

  describe('sourcePutRequest', () => {
    it('uploaded=true marks the source downloaded and the item synced', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const uuid = '44444444-4444-4444-4444-444444444444';
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        uuid,
        synced: false,
      });
      await createTestExternalResource(trx, {
        library_item_id: item.id_library_item,
        sync_status: 'pending',
      });

      const result = await service.sourcePutRequest(user as any, {
        uuid,
        uploaded: true,
      });

      expect(result).toBe(true);
      const resourceAfter = await trx('external_resources')
        .where({ library_item_id: item.id_library_item })
        .first();
      const itemAfter = await trx('library_items')
        .where({ id_library_item: item.id_library_item })
        .first();
      expect(resourceAfter.sync_status).toBe('downloaded');
      expect(itemAfter.synced).toBe(true);
    });

    it('uploaded=false builds the PUT key from the storage prefix (external_id), not the email', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const uuid = '55555555-5555-5555-5555-555555555555';
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        uuid,
        source_path: 'root/source_book.m4b',
      });

      // Relay / "Hide My Email" account: getPrefix resolves to external_id.
      const getPrefix = jest.fn<() => Promise<string>>().mockResolvedValue('ext-abc');
      const getPresignedUrl = jest
        .fn<(params: { key: string; type: StorageAction }) => Promise<{ url: string }>>()
        .mockResolvedValue({ url: 'https://signed.example/put' });
      (service as any)._prefix = { getPrefix };
      (service as any)._storage = { getPresignedUrl };

      const url = await service.sourcePutRequest(user as any, {
        uuid,
        uploaded: false,
      });

      expect(url).toBe('https://signed.example/put');
      expect(getPrefix).toHaveBeenCalled();
      expect(getPresignedUrl).toHaveBeenCalledWith({
        key: 'ext-abc/root/source_book.m4b',
        type: StorageAction.PUT,
      });
      // Must not leak the email-based prefix.
      const calledKey = getPresignedUrl.mock.calls[0][0].key;
      expect(calledKey).not.toContain(user.email);
    });

    it('throws when the item does not exist', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await expect(
        service.sourcePutRequest(user as any, {
          uuid: '66666666-6666-6666-6666-666666666666',
          uploaded: false,
        }),
      ).rejects.toThrow();
    });
  });
});
