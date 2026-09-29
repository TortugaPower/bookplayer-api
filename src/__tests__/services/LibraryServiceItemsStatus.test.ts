import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { LibraryService, LibraryLookupError } from '../../services/LibraryService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * POST /v1/library/status, the clients' missing-items pass: of the uuids in a
 * local library, `unknown` are the ones the server has no row for (the client
 * registers them: nothing on the server holds the uuid, so the PUT can't move
 * anything) and `unsynced` are active books with no file in S3 (a PRO client
 * uploads them by uuid, never by path).
 */
describe('LibraryService.getItemsStatus', () => {
  let service: LibraryService;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const user = async (email = 'status@example.com') => {
    const row = await createTestUser(getTestTransaction(), { email });
    return { ...row, subscriptions: [] } as any;
  };

  it('sorts a library into unknown, unsynced, and neither', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const synced = await createTestLibraryItem(trx, { user_id: owner.id_user, key: 'Synced.m4b' });
    const noFile = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'NoFile.m4b',
      synced: false,
    });
    const folder = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Folder',
      type: 0,
      synced: false,
    });
    const bound = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Bound',
      type: 1,
      synced: false,
    });
    const neverSeen = randomUUID();

    const status = await service.getItemsStatus(owner, [
      synced.uuid,
      noFile.uuid,
      folder.uuid,
      bound.uuid,
      neverSeen,
    ]);

    expect(status).toEqual({ unknown: [neverSeen], unsynced: [noFile.uuid] });
  });

  it('counts a deleted item as seen, so a book deleted elsewhere is never registered again', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const deletedBook = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Deleted.m4b',
      active: false,
      synced: false,
    });

    const status = await service.getItemsStatus(owner, [deletedBook.uuid]);

    expect(status).toEqual({ unknown: [], unsynced: [] });
  });

  it('merges every row holding a uuid: the active one decides, deleted ones only mark it seen', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    // An active synced book whose uuid an older, deleted row also carries
    const synced = await createTestLibraryItem(trx, { user_id: owner.id_user, key: 'Kept.m4b' });
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Kept-old.m4b',
      uuid: synced.uuid,
      active: false,
      synced: false,
    });
    // An active unsynced book with two deleted rows under its uuid
    const unsynced = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Waiting.m4b',
      synced: false,
    });
    for (const key of ['Waiting-a.m4b', 'Waiting-b.m4b']) {
      await createTestLibraryItem(trx, {
        user_id: owner.id_user,
        key,
        uuid: unsynced.uuid,
        active: false,
        synced: false,
      });
    }

    const status = await service.getItemsStatus(owner, [synced.uuid, unsynced.uuid]);

    expect(status).toEqual({ unknown: [], unsynced: [unsynced.uuid] });
  });

  it('reads a NULL synced as no file in S3', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const book = await createTestLibraryItem(trx, { user_id: owner.id_user, key: 'Legacy.m4b' });
    await trx('library_items').update({ synced: null }).where({ id_library_item: book.id_library_item });

    const status = await service.getItemsStatus(owner, [book.uuid]);

    expect(status.unsynced).toEqual([book.uuid]);
  });

  it("answers another user's uuid as unknown: only the caller's rows count", async () => {
    const trx = getTestTransaction();
    const owner = await user('owner@example.com');
    const other = await user('other@example.com');
    const theirs = await createTestLibraryItem(trx, {
      user_id: other.id_user,
      key: 'Theirs.m4b',
      synced: false,
    });

    const status = await service.getItemsStatus(owner, [theirs.uuid]);

    expect(status).toEqual({ unknown: [theirs.uuid], unsynced: [] });
  });

  it('answers in the spelling the client sent, once per uuid', async () => {
    // iOS generates uppercase uuids; Postgres hands them back lowercased
    const trx = getTestTransaction();
    const owner = await user();
    const book = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Upper.m4b',
      synced: false,
    });
    const upperBook = book.uuid.toUpperCase();
    const upperUnknown = randomUUID().toUpperCase();

    const status = await service.getItemsStatus(owner, [
      upperBook,
      upperUnknown,
      upperUnknown,
      upperBook.toLowerCase(),
    ]);

    expect(status).toEqual({ unknown: [upperUnknown], unsynced: [upperBook] });
  });

  it('leaves strings that are not uuids out of both lists instead of failing the request', async () => {
    const owner = await user();
    const neverSeen = randomUUID();

    const status = await service.getItemsStatus(owner, [
      'Optional("2c2d0f44-1111-4111-8111-111111111111")',
      '',
      neverSeen,
    ]);

    expect(status).toEqual({ unknown: [neverSeen], unsynced: [] });
  });

  it('skips the query for an empty or all-invalid list', async () => {
    const owner = await user();
    const lookup = jest.spyOn((service as any)._libraryDB, 'getItemsByUuids');

    await expect(service.getItemsStatus(owner, [])).resolves.toEqual({ unknown: [], unsynced: [] });
    await expect(service.getItemsStatus(owner, ['not-a-uuid'])).resolves.toEqual({ unknown: [], unsynced: [] });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('handles a library far past the 65,535-parameter limit in one query per half', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const book = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Big.m4b',
      synced: false,
    });
    const library = [book.uuid, ...Array.from({ length: 70_000 }, () => randomUUID())];

    const status = await service.getItemsStatus(owner, library);

    expect(status.unsynced).toEqual([book.uuid]);
    expect(status.unknown).toHaveLength(70_000);
  });

  it('throws LibraryLookupError when the read fails: "all unknown" would re-register the whole library', async () => {
    const owner = await user();
    jest.spyOn((service as any)._libraryDB, 'getItemsByUuids').mockResolvedValue(null as never);

    await expect(service.getItemsStatus(owner, [randomUUID()])).rejects.toBeInstanceOf(LibraryLookupError);
  });
});
