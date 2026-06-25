import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryDB, externalResourceRowToApi } from '../../services/db/LibraryDB';
import { ExternalResource } from '../../types/user';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
  createTestExternalResource,
} from '../setup';

// Semantics: `providerName` is the storage provider (e.g. "dropbox"); `providerId`
// is the resource's id *within* that provider (the provider's file id), not an id
// of the provider itself.

describe('LibraryDB — external_resources', () => {
  let db: LibraryDB;

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('insertExternalResource', () => {
    it('persists the camelCase wire fields into snake_case columns', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
      });

      const resource: ExternalResource = {
        providerName: 'dropbox',
        providerId: 'id:9f8e7d6c-file', // provider's file id for this item
        syncStatus: 'pending',
        lastSyncedAt: null,
        processedFile: false,
        hostId: 'host-1',
      };

      const inserted = await db.insertExternalResource(
        item.id_library_item,
        resource,
        trx,
      );
      expect(inserted).not.toBeNull();

      const row = await trx('external_resources')
        .where({ library_item_id: item.id_library_item })
        .first();

      expect(row.provider_name).toBe('dropbox');
      expect(row.provider_id).toBe('id:9f8e7d6c-file');
      expect(row.sync_status).toBe('pending');
      expect(row.processed_file).toBe(false);
      expect(row.host_id).toBe('host-1');
      expect(row.library_item_id).toBe(item.id_library_item);
    });

    it('returns null and logs when the library item does not exist (FK violation)', async () => {
      const trx = getTestTransaction();
      const resource: ExternalResource = {
        providerName: 'dropbox',
        providerId: 'id:orphan-file',
        syncStatus: 'pending',
        lastSyncedAt: null,
        processedFile: false,
      };

      const inserted = await db.insertExternalResource(2_147_000_000, resource, trx);

      expect(inserted).toBeNull();
      expect(mockLoggerService.log).toHaveBeenCalled();
    });
  });

  describe('getExternalResource', () => {
    it('matches on (library_item_id, provider_id, provider_name)', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
      });
      await createTestExternalResource(trx, {
        library_item_id: item.id_library_item,
        provider_name: 'gdrive',
        provider_id: 'file-1aBc',
      });

      const found = await db.getExternalResource(
        item.id_library_item,
        'file-1aBc',
        'gdrive',
        trx,
      );

      expect(found).toBeTruthy();
      expect(found?.provider_id).toBe('file-1aBc');
      expect(found?.provider_name).toBe('gdrive');
    });

    it('does not match a different provider_id on the same item', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
      });
      await createTestExternalResource(trx, {
        library_item_id: item.id_library_item,
        provider_name: 'gdrive',
        provider_id: 'file-1aBc',
      });

      const found = await db.getExternalResource(
        item.id_library_item,
        'file-other',
        'gdrive',
        trx,
      );

      expect(found).toBeFalsy();
    });
  });

  describe('getExternalResources', () => {
    it('returns every row for the given library_item_ids', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const itemA = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'a.m4b',
      });
      const itemB = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'b.m4b',
      });
      await createTestExternalResource(trx, {
        library_item_id: itemA.id_library_item,
        provider_id: 'file-a',
      });
      await createTestExternalResource(trx, {
        library_item_id: itemB.id_library_item,
        provider_id: 'file-b',
      });

      const rows = await db.getExternalResources(
        [itemA.id_library_item, itemB.id_library_item],
        trx,
      );

      expect(rows).toHaveLength(2);
      const ids = rows!.map((r) => r.library_item_id).sort();
      expect(ids).toEqual([itemA.id_library_item, itemB.id_library_item].sort());
    });
  });

  describe('markExternalSourceUploaded', () => {
    it('flips external_resources.sync_status and library_items.synced together', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const item = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
        synced: false,
      });
      await createTestExternalResource(trx, {
        library_item_id: item.id_library_item,
        sync_status: 'pending',
      });

      const ok = await db.markExternalSourceUploaded(item.id_library_item, trx);
      expect(ok).toBe(true);

      const resourceAfter = await trx('external_resources')
        .where({ library_item_id: item.id_library_item })
        .first();
      const itemAfter = await trx('library_items')
        .where({ id_library_item: item.id_library_item })
        .first();

      expect(resourceAfter.sync_status).toBe('downloaded');
      expect(itemAfter.synced).toBe(true);
    });
  });

  describe('externalResourceRowToApi', () => {
    it('maps snake_case columns to the camelCase wire contract', () => {
      const api = externalResourceRowToApi({
        id: 1,
        library_item_id: 42,
        provider_name: 'dropbox',
        provider_id: 'file-9',
        sync_status: 'downloaded',
        last_synced_at: null,
        processed_file: true,
        host_id: 'h-1',
        active: true,
        created_at: new Date(0),
        updated_at: new Date(0),
      });

      expect(api).toEqual({
        providerName: 'dropbox',
        providerId: 'file-9',
        syncStatus: 'downloaded',
        lastSyncedAt: null,
        processedFile: true,
        hostId: 'h-1',
      });
    });
  });
});
