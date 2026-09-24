import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ITEM_DELETED, LibraryLookupError, LibraryService } from '../../services/LibraryService';
import { LibraryDB } from '../../services/db/LibraryDB';
import { ApiError, ApiErrorCode } from '../../types/apiError';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * A request that names an item with no active row either targets something
 * the user deleted (the intent no longer applies: success, nothing changes) or
 * something that never existed on the server (`item_not_found`, which the apps
 * stop on and report). A failed read is neither: it's a retryable 500.
 */
describe('LibraryService — requests naming a missing item', () => {
  let service: LibraryService;

  const ORIGIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const FOLDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const NEVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    (service as any)._storage = {
      moveFile: jest.fn(async () => true),
      fileExists: jest.fn(async () => false),
      deleteFile: jest.fn(async () => true),
      getPresignedUrl: jest.fn(async () => ({ url: 'https://s3.example/put' })),
    };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    mockLoggerService.log.mockClear();
  });

  const expectNotFound = async (promise: Promise<unknown>) => {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: ApiErrorCode.ITEM_NOT_FOUND, statusCode: 404 });
  };

  describe('move by uuid', () => {
    it('does nothing when the book was deleted', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', uuid: ORIGIN, active: false });

      await expect(
        service.moveLibraryObjectByUuid(user as any, { origin: ORIGIN, destination: '' }),
      ).resolves.toEqual([]);
    });

    it('answers item_not_found for a book that never existed here', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await expectNotFound(service.moveLibraryObjectByUuid(user as any, { origin: NEVER, destination: '' }));
    });

    it('leaves the book where it is when its destination folder was deleted', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const book = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', uuid: ORIGIN });
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Series', type: 0, uuid: FOLDER, active: false });

      await expect(
        service.moveLibraryObjectByUuid(user as any, { origin: ORIGIN, destination: FOLDER }),
      ).resolves.toEqual([]);

      const after = await trx('library_items').where({ id_library_item: book.id_library_item }).first();
      expect(after.key).toBe('Book.m4b');
    });

    it('never moves a book to the root because its destination folder is missing', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const book = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Series 2/Book.m4b', uuid: ORIGIN });

      await expectNotFound(
        service.moveLibraryObjectByUuid(user as any, { origin: ORIGIN, destination: NEVER }),
      );

      const after = await trx('library_items').where({ id_library_item: book.id_library_item }).first();
      expect(after.key).toBe('Series 2/Book.m4b');
    });

    it('raises a lookup failure, not a not-found, when the read fails', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      jest.spyOn((service as any)._libraryDB as LibraryDB, 'getLibraryByUuid').mockResolvedValueOnce(null);

      await expect(
        service.moveLibraryObjectByUuid(user as any, { origin: ORIGIN, destination: '' }),
      ).rejects.toBeInstanceOf(LibraryLookupError);
    });
  });

  it('raises a lookup failure when the deleted-row check itself fails', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    jest.spyOn((service as any)._libraryDB as LibraryDB, 'hasDeletedItem').mockResolvedValueOnce(null);

    await expect(service.confirmDeleted(user as any, { uuid: NEVER })).rejects.toBeInstanceOf(LibraryLookupError);
  });

  it('raises a lookup failure for folder_in_out by path when the read fails', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    jest.spyOn((service as any)._libraryDB as LibraryDB, 'getLibrary').mockResolvedValueOnce(null);

    await expect(service.deleteFolderMoving(user as any, 'Series')).rejects.toBeInstanceOf(LibraryLookupError);
  });

  describe('move by path', () => {
    it('does nothing when the book was deleted, and creates no destination folder', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', active: false });

      await expect(
        service.moveLibraryObject(user as any, { origin: 'Book.m4b', destination: 'New Folder' }),
      ).resolves.toEqual([]);

      const folder = await trx('library_items').where({ user_id: user.id_user, key: 'New Folder' }).first();
      expect(folder).toBeUndefined();
    });

    it('answers item_not_found for a book that never existed here', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await expectNotFound(service.moveLibraryObject(user as any, { origin: 'Ghost.m4b', destination: '' }));
    });
  });

  describe('external resources', () => {
    const resource = {
      providerId: 'p1',
      providerName: 'jellyfin',
      syncStatus: 'stream',
      processedFile: false,
      lastSyncedAt: 0,
    } as any;

    it('links nothing to a deleted book', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', uuid: ORIGIN, active: false });

      await expect(service.putExternalResource(user as any, ORIGIN, resource)).resolves.toBeNull();
    });

    it('answers item_not_found when linking to a book that never existed here', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      await expectNotFound(service.putExternalResource(user as any, NEVER, resource));
    });

    it('treats unlinking a missing book or a missing link as done', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', uuid: ORIGIN });

      await expect(service.deleteExternalResource(user as any, NEVER, 'p1', 'jellyfin')).resolves.toBeNull();
      await expect(service.deleteExternalResource(user as any, ORIGIN, 'p1', 'jellyfin')).resolves.toBeNull();
    });

    it('keeps a failed unlink write retryable instead of reporting it done', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', uuid: ORIGIN });
      jest.spyOn((service as any)._libraryDB as LibraryDB, 'softDeleteExternalResource').mockResolvedValueOnce(null);

      await expect(
        service.deleteExternalResource(user as any, ORIGIN, 'p1', 'jellyfin'),
      ).rejects.toBeInstanceOf(LibraryLookupError);
    });
  });

  describe('thumbnails', () => {
    it('answers ITEM_DELETED for a deleted book, and item_not_found for one that never existed', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b', uuid: ORIGIN, active: false });

      await expect(
        service.thumbnailPutRequest(user as any, { relativePath: 'Book.m4b', uuid: ORIGIN, thumbnail_name: 't.jpg' }),
      ).resolves.toBe(ITEM_DELETED);
      await expectNotFound(
        service.thumbnailPutRequest(user as any, { relativePath: 'Ghost.m4b', uuid: NEVER, thumbnail_name: 't.jpg' }),
      );
    });
  });

  it('keeps the uuid conflict on upload as a coded 409', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Folder', type: 0, uuid: ORIGIN });

    await expect(
      service.putObject(user as any, {
        relativePath: 'Elsewhere/Book.m4b',
        originalFileName: 'Book.m4b',
        title: 'Book',
        details: 'Author',
        currentTime: 0,
        duration: 10,
        percentCompleted: 0,
        isFinished: false,
        orderRank: 0,
        lastPlayDateTimestamp: 0,
        type: 2,
        uuid: ORIGIN,
      } as any),
    ).rejects.toMatchObject({ code: ApiErrorCode.UUID_CONFLICT, statusCode: 409 });
  });
});

describe('LibraryDB — deleted items and bookmark deletes', () => {
  let db: LibraryDB;

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
  });

  it('finds a soft-deleted row by uuid or key, and ignores active rows', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Gone.m4b', uuid, active: false });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Here.m4b' });

    expect(await db.hasDeletedItem(user.id_user, { uuid })).toBe(true);
    expect(await db.hasDeletedItem(user.id_user, { key: 'Gone.m4b' })).toBe(true);
    expect(await db.hasDeletedItem(user.id_user, { key: 'Here.m4b' })).toBe(false);
    expect(await db.hasDeletedItem(user.id_user, { key: 'Never.m4b' })).toBe(false);
    // A folder sent as `Folder/` is the same key.
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Old Series', type: 0, active: false });
    expect(await db.hasDeletedItem(user.id_user, { key: 'Old Series/' })).toBe(true);
  });

  it('deactivates an existing bookmark and never inserts an unknown one', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b' });
    await trx('bookmarks').insert({ library_item_id: item.id_library_item, time: 120, note: 'n', active: true });

    await expect(db.deactivateBookmark({ library_item_id: item.id_library_item, time: 120 })).resolves.toMatchObject({
      time: 120,
      active: false,
    });
    await expect(db.deactivateBookmark({ library_item_id: item.id_library_item, time: 300 })).resolves.toBeUndefined();

    const rows = await trx('bookmarks').where({ library_item_id: item.id_library_item });
    expect(rows).toHaveLength(1);
  });
});
