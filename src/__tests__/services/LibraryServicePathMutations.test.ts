import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * Characterization tests for the three path-mutating flows, with fixtures
 * shaped like the request bodies the iOS client actually sends
 * (LibraryAPI.swift on branch develop):
 *
 * - move:    POST /v1/library/move          { origin, destination, uuid }
 *            origin/destination are uuids when the item has a real uuid
 *            (controller routes to moveLibraryObjectByUuid), else
 *            relativePaths (moveLibraryObject); destination "" = root.
 * - rename:  POST /v1/library/rename        { relativePath, newName, uuid }
 *            controller resolves the item row, service gets { item, newName }.
 * - shallow: DELETE /v1/library/folder_in_out { relativePath, uuid }
 *            children survive, promoted into the folder's parent.
 */
describe('LibraryService — path-mutating flows (move / rename / folder_in_out)', () => {
  let service: LibraryService;
  let moveFileMock: jest.Mock;
  let fileExistsMock: jest.Mock;
  let deleteFileMock: jest.Mock;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    moveFileMock = jest.fn(async () => true);
    fileExistsMock = jest.fn(async () => false);
    deleteFileMock = jest.fn(async () => true);
    (service as any)._storage = {
      moveFile: moveFileMock,
      fileExists: fileExistsMock,
      deleteFile: deleteFileMock,
    };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    mockLoggerService.log.mockClear();
  });

  describe('moveLibraryObject — legacy path-based /move body', () => {
    it('nests the folder and its children inside the destination and reports old keys', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series',
        type: 0,
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series/a.m4b',
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
      });

      const moved = await service.moveLibraryObject(user as any, {
        origin: 'Series',
        destination: '0_FINISHED',
      });

      const byOldKey = new Map(moved.map((m) => [m.old_key, m.key]));
      expect(byOldKey.get('Series')).toBe('0_FINISHED/Series');
      expect(byOldKey.get('Series/a.m4b')).toBe('0_FINISHED/Series/a.m4b');
    });

    it('does not drag same-prefix siblings along (folder "Series" vs "Series 2")', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series',
        type: 0,
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series/a.m4b',
      });
      const sibling = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series 2.m4b',
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
      });

      await service.moveLibraryObject(user as any, {
        origin: 'Series',
        destination: '0_FINISHED',
      });

      const siblingAfter = await trx('library_items')
        .where({ id_library_item: sibling.id_library_item })
        .first();
      expect(siblingAfter.key).toBe('Series 2.m4b');
      expect(siblingAfter.active).toBe(true);
    });

    it('does not treat LIKE wildcards in folder names as wildcards ("My_Books" vs "MyXBooks")', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'My_Books',
        type: 0,
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'My_Books/a.m4b',
      });
      const bystander = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'MyXBooks/a.m4b',
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
      });

      await service.moveLibraryObject(user as any, {
        origin: 'My_Books',
        destination: '0_FINISHED',
      });

      const bystanderAfter = await trx('library_items')
        .where({ id_library_item: bystander.id_library_item })
        .first();
      expect(bystanderAfter.key).toBe('MyXBooks/a.m4b');
    });

    it('moves a book to the library root when destination is ""', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const book = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_TBR/Book.m4b',
      });

      await service.moveLibraryObject(user as any, {
        origin: '0_TBR/Book.m4b',
        destination: '',
      });

      const bookAfter = await trx('library_items')
        .where({ id_library_item: book.id_library_item })
        .first();
      expect(bookAfter.key).toBe('Book.m4b');
    });

    it('creates the destination folder when it does not exist', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Book.m4b',
      });

      await service.moveLibraryObject(user as any, {
        origin: 'Book.m4b',
        destination: 'New Folder',
      });

      const folder = await trx('library_items')
        .where({ user_id: user.id_user, key: 'New Folder', active: true })
        .first();
      expect(folder).toBeDefined();
      expect(`${folder.type}`).toBe('0');
      expect(folder.synced).toBe(true);
    });

    it('returns [] when the item was already moved to the destination', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED/Book.m4b',
      });

      const moved = await service.moveLibraryObject(user as any, {
        origin: 'Book.m4b',
        destination: '0_FINISHED',
      });
      expect(moved).toEqual([]);
    });

    it('rejects a book as destination', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Book.m4b',
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Other.m4b',
      });

      await expect(
        service.moveLibraryObject(user as any, {
          origin: 'Book.m4b',
          destination: 'Other.m4b',
        }),
      ).rejects.toThrow('The destination is invalid');
    });
  });

  describe('moveLibraryObjectByUuid — real-uuid /move body', () => {
    it('moves by origin/destination uuids', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const originUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const destUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const book = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Book.m4b',
        uuid: originUuid,
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
        uuid: destUuid,
      });

      await service.moveLibraryObjectByUuid(user as any, {
        origin: originUuid,
        destination: destUuid,
      });

      const bookAfter = await trx('library_items')
        .where({ id_library_item: book.id_library_item })
        .first();
      expect(bookAfter.key).toBe('0_FINISHED/Book.m4b');
    });

    it('moves to the root when destination uuid is ""', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const originUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const book = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_TBR/Book.m4b',
        uuid: originUuid,
      });

      await service.moveLibraryObjectByUuid(user as any, {
        origin: originUuid,
        destination: '',
      });

      const bookAfter = await trx('library_items')
        .where({ id_library_item: book.id_library_item })
        .first();
      expect(bookAfter.key).toBe('Book.m4b');
    });
  });

  describe('move — S3 side effects (processMovedFiles)', () => {
    it('moves the S3 object and backfills source_path for a legacy book (source_path null)', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const book = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Legacy.m4b',
        source_path: null,
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
      });

      await service.moveLibraryObject(user as any, {
        origin: 'Legacy.m4b',
        destination: '0_FINISHED',
      });

      expect(moveFileMock).toHaveBeenCalledTimes(1);
      const call = moveFileMock.mock.calls[0][0] as {
        sourceKey: string;
        targetKey: string;
      };
      expect(call.sourceKey).toBe('test-prefix/Legacy.m4b');
      expect(call.targetKey).toMatch(/^test-prefix\/.*_Legacy\.m4b$/);

      const bookAfter = await trx('library_items')
        .where({ id_library_item: book.id_library_item })
        .first();
      expect(bookAfter.source_path).not.toBeNull();
    });

    it('does not touch S3 for a book that already has a source_path', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Modern.m4b',
        source_path: 'root/20260101000000_Modern.m4b',
      });
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_FINISHED',
        type: 0,
      });

      await service.moveLibraryObject(user as any, {
        origin: 'Modern.m4b',
        destination: '0_FINISHED',
      });

      expect(moveFileMock).not.toHaveBeenCalled();
    });
  });

  describe('renameLibraryObject — /rename body { relativePath, newName, uuid }', () => {
    it('renames a book title without touching its key', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const book = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Book.m4b',
      });
      const itemDb = await trx('library_items')
        .where({ id_library_item: book.id_library_item })
        .first();

      const result = await service.renameLibraryObject(user as any, {
        item: itemDb,
        newName: 'Better Title',
      });

      expect(result[0].key).toBe('Book.m4b');
      expect(result[0].old_key).toBe('Book.m4b');
      const after = await trx('library_items')
        .where({ id_library_item: book.id_library_item })
        .first();
      expect(after.title).toBe('Better Title');
      expect(after.key).toBe('Book.m4b');
    });

    it('renames a folder and re-prefixes its children, leaving same-prefix siblings alone', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const folder = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Old Folder',
        type: 0,
      });
      const child = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Old Folder/a.m4b',
      });
      const sibling = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Old Folder 2.m4b',
      });
      const itemDb = await trx('library_items')
        .where({ id_library_item: folder.id_library_item })
        .first();

      await service.renameLibraryObject(user as any, {
        item: itemDb,
        newName: 'New Folder',
      });

      const folderAfter = await trx('library_items')
        .where({ id_library_item: folder.id_library_item })
        .first();
      const childAfter = await trx('library_items')
        .where({ id_library_item: child.id_library_item })
        .first();
      const siblingAfter = await trx('library_items')
        .where({ id_library_item: sibling.id_library_item })
        .first();
      expect(folderAfter.key).toBe('New Folder');
      expect(childAfter.key).toBe('New Folder/a.m4b');
      expect(siblingAfter.key).toBe('Old Folder 2.m4b');
      expect(siblingAfter.active).toBe(true);
    });

    it('merges into an existing empty destination folder and soft-deletes the origin', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const origin = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Old Folder',
        type: 0,
      });
      // Origin has data (duration != '0')
      await trx('library_items')
        .where({ id_library_item: origin.id_library_item })
        .update({ duration: '120', details: '1 Files' });
      const child = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Old Folder/a.m4b',
      });
      // Destination exists and is empty (duration '0' per createTestLibraryItem)
      const destination = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'New Folder',
        type: 0,
      });
      const itemDb = await trx('library_items')
        .where({ id_library_item: origin.id_library_item })
        .first();

      const result = await service.renameLibraryObject(user as any, {
        item: itemDb,
        newName: 'New Folder',
      });

      expect(result[0].id_library_item).toBe(destination.id_library_item);
      expect(result[0].key).toBe('New Folder');
      expect(result[0].old_key).toBe('Old Folder');

      const originAfter = await trx('library_items')
        .where({ id_library_item: origin.id_library_item })
        .first();
      const childAfter = await trx('library_items')
        .where({ id_library_item: child.id_library_item })
        .first();
      const destAfter = await trx('library_items')
        .where({ id_library_item: destination.id_library_item })
        .first();
      expect(originAfter.active).toBe(false);
      expect(childAfter.key).toBe('New Folder/a.m4b');
      expect(destAfter.active).toBe(true);
      expect(destAfter.duration).toBe('120');
    });
  });

  describe('deleteFolderMoving — /folder_in_out body { relativePath, uuid }', () => {
    it('soft-deletes the folder and promotes children into its parent', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const folder = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_TBR/Series',
        type: 0,
      });
      const childA = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_TBR/Series/a.m4b',
      });
      const childB = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: '0_TBR/Series/b.m4b',
      });

      const ok = await service.deleteFolderMoving(user as any, '0_TBR/Series');
      expect(ok).toBe(true);

      const folderAfter = await trx('library_items')
        .where({ id_library_item: folder.id_library_item })
        .first();
      const childAAfter = await trx('library_items')
        .where({ id_library_item: childA.id_library_item })
        .first();
      const childBAfter = await trx('library_items')
        .where({ id_library_item: childB.id_library_item })
        .first();
      expect(folderAfter.active).toBe(false);
      expect(childAAfter.key).toBe('0_TBR/a.m4b');
      expect(childBAfter.key).toBe('0_TBR/b.m4b');
    });

    it('promotes children of a root folder to the library root without a leading slash', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series',
        type: 0,
      });
      const child = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series/a.m4b',
      });

      await service.deleteFolderMoving(user as any, 'Series');

      const childAfter = await trx('library_items')
        .where({ id_library_item: child.id_library_item })
        .first();
      expect(childAfter.key).toBe('a.m4b');
    });

    it('deactivates an occupant already sitting at a promoted key', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series',
        type: 0,
      });
      const child = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series/a.m4b',
      });
      const occupant = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'a.m4b',
      });

      await service.deleteFolderMoving(user as any, 'Series');

      const childAfter = await trx('library_items')
        .where({ id_library_item: child.id_library_item })
        .first();
      const occupantAfter = await trx('library_items')
        .where({ id_library_item: occupant.id_library_item })
        .first();
      expect(childAfter.key).toBe('a.m4b');
      expect(childAfter.active).toBe(true);
      expect(occupantAfter.active).toBe(false);
      expect(occupantAfter.uuid).toBeNull();
    });

    it('moves the S3 object for a legacy child book (source_path null) using its pre-move key', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series',
        type: 0,
      });
      const child = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Series/a.m4b',
        source_path: null,
      });

      await service.deleteFolderMoving(user as any, 'Series');

      expect(moveFileMock).toHaveBeenCalledTimes(1);
      const call = moveFileMock.mock.calls[0][0] as {
        sourceKey: string;
        targetKey: string;
      };
      expect(call.sourceKey).toBe('test-prefix/Series/a.m4b');

      const childAfter = await trx('library_items')
        .where({ id_library_item: child.id_library_item })
        .first();
      expect(childAfter.source_path).not.toBeNull();
    });
  });
});
