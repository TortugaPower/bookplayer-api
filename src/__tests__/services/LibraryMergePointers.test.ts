import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { LibraryDB } from '../../services/db/LibraryDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
  createTestMerge,
} from '../setup';

/**
 * Same-name merges (docs/same-name-merges.md): when an item arrives at a key
 * another item already holds, the item already there survives and the
 * arriving item's uuid becomes a pointer to it. Lookups by uuid follow the
 * pointer only when the uuid has no active row of its own, so a request that
 * still names the old uuid lands on the merged item instead of a 404.
 * `/status` stays pointer-blind on purpose: a merged uuid reads as unknown,
 * which makes both apps re-match the item by path and take the survivor's uuid.
 */
const SURVIVOR = '11111111-1111-4111-8111-111111111111';
const MERGED = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('LibraryDB — merged uuids', () => {
  let libraryDB: LibraryDB;

  beforeEach(() => {
    libraryDB = new LibraryDB();
    (libraryDB as any).db = getTestTransaction();
    (libraryDB as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('getLibraryByUuid', () => {
    it('resolves a merged uuid to the item it merged into', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const survivor = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Dune.m4b',
        uuid: SURVIVOR,
      });
      await createTestMerge(trx, {
        user_id: user.id_user,
        merged_uuid: MERGED,
        into_item_id: survivor.id_library_item,
      });

      const rows = await libraryDB.getLibraryByUuid(user.id_user, MERGED);

      expect(rows).toHaveLength(1);
      expect(rows[0].id_library_item).toBe(survivor.id_library_item);
      expect(rows[0].uuid).toBe(SURVIVOR);
    });

    it("answers a uuid with an active row of its own from that row, even if it also has a pointer", async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const own = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Own.m4b',
        uuid: SURVIVOR,
      });
      const elsewhere = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Elsewhere.m4b',
        uuid: OTHER,
      });
      await createTestMerge(trx, {
        user_id: user.id_user,
        merged_uuid: SURVIVOR,
        into_item_id: elsewhere.id_library_item,
      });

      const rows = await libraryDB.getLibraryByUuid(user.id_user, SURVIVOR);

      expect(rows.map((r) => r.id_library_item)).toEqual([own.id_library_item]);
    });

    it('finds nothing when the item it merged into was deleted', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const survivor = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Dune.m4b',
        uuid: SURVIVOR,
        active: false,
      });
      await createTestMerge(trx, {
        user_id: user.id_user,
        merged_uuid: MERGED,
        into_item_id: survivor.id_library_item,
      });

      expect(await libraryDB.getLibraryByUuid(user.id_user, MERGED)).toEqual([]);
    });

    it("ignores another user's pointer for the same uuid", async () => {
      const trx = getTestTransaction();
      const owner = await createTestUser(trx, { email: 'owner@example.com' });
      const stranger = await createTestUser(trx, { email: 'stranger@example.com' });
      const strangersItem = await createTestLibraryItem(trx, {
        user_id: stranger.id_user,
        key: 'Dune.m4b',
        uuid: SURVIVOR,
      });
      await createTestMerge(trx, {
        user_id: stranger.id_user,
        merged_uuid: MERGED,
        into_item_id: strangersItem.id_library_item,
      });

      expect(await libraryDB.getLibraryByUuid(owner.id_user, MERGED)).toEqual([]);
    });

    it('finds nothing for a uuid with neither a row nor a pointer', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      expect(await libraryDB.getLibraryByUuid(user.id_user, OTHER)).toEqual([]);
    });
  });

  describe('hasDeletedItem', () => {
    it('counts a merged uuid as deleted when the item it merged into was deleted', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const survivor = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Dune.m4b',
        uuid: SURVIVOR,
        active: false,
      });
      await createTestMerge(trx, {
        user_id: user.id_user,
        merged_uuid: MERGED,
        into_item_id: survivor.id_library_item,
      });

      expect(await libraryDB.hasDeletedItem(user.id_user, { uuid: MERGED })).toBe(true);
    });

    it('does not count a merged uuid as deleted while the item it merged into is active', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const survivor = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Dune.m4b',
        uuid: SURVIVOR,
      });
      await createTestMerge(trx, {
        user_id: user.id_user,
        merged_uuid: MERGED,
        into_item_id: survivor.id_library_item,
      });

      expect(await libraryDB.hasDeletedItem(user.id_user, { uuid: MERGED })).toBe(false);
    });

    it('still finds nothing deleted for a uuid without a pointer', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      expect(await libraryDB.hasDeletedItem(user.id_user, { uuid: OTHER })).toBe(false);
    });
  });

  describe('getBookmarks', () => {
    it("returns the bookmarks of the item a merged uuid merged into", async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);
      const survivor = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Dune.m4b',
        uuid: SURVIVOR,
      });
      const other = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Other.m4b',
        uuid: OTHER,
      });
      await trx('bookmarks').insert([
        { library_item_id: survivor.id_library_item, time: 120, note: 'survivor', active: true },
        { library_item_id: other.id_library_item, time: 60, note: 'other', active: true },
      ]);
      await createTestMerge(trx, {
        user_id: user.id_user,
        merged_uuid: MERGED,
        into_item_id: survivor.id_library_item,
      });

      const bookmarks = await libraryDB.getBookmarks({ user_id: user.id_user, uuid: MERGED });

      expect(bookmarks.map((b) => b.note)).toEqual(['survivor']);
    });
  });
});

describe('LibraryService — merged uuids', () => {
  let service: LibraryService;

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
      listMultipartUploads: jest.fn(async () => []),
    };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    mockLoggerService.log.mockClear();
  });

  it('moves the item a merged origin uuid merged into', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const survivor = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Sci-Fi',
      type: 0,
      uuid: OTHER,
    });
    await createTestMerge(trx, {
      user_id: user.id_user,
      merged_uuid: MERGED,
      into_item_id: survivor.id_library_item,
    });

    await service.moveLibraryObjectByUuid(user as any, { origin: MERGED, destination: OTHER });

    const after = await trx('library_items')
      .where({ id_library_item: survivor.id_library_item })
      .first();
    expect(after.key).toBe('Sci-Fi/Dune.m4b');
  });

  it('moves an item into the folder a merged destination uuid merged into', async () => {
    // The case that prompted merges: the phone's new folder uuid was dropped
    // because another device already had a folder by that name, and the
    // phone's move into it 404'd.
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const folder = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series 1',
      type: 0,
      uuid: SURVIVOR,
    });
    const book = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Part 1.m4b',
      uuid: OTHER,
    });
    await createTestMerge(trx, {
      user_id: user.id_user,
      merged_uuid: MERGED,
      into_item_id: folder.id_library_item,
    });

    await service.moveLibraryObjectByUuid(user as any, { origin: OTHER, destination: MERGED });

    const after = await trx('library_items').where({ id_library_item: book.id_library_item }).first();
    expect(after.key).toBe('Series 1/Part 1.m4b');
  });

  it('answers a move into a merged folder that was since deleted as done, not item_not_found', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const folder = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series 1',
      type: 0,
      uuid: SURVIVOR,
      active: false,
    });
    const book = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Part 1.m4b',
      uuid: OTHER,
    });
    await createTestMerge(trx, {
      user_id: user.id_user,
      merged_uuid: MERGED,
      into_item_id: folder.id_library_item,
    });

    await expect(
      service.moveLibraryObjectByUuid(user as any, { origin: OTHER, destination: MERGED }),
    ).resolves.toEqual([]);
    const after = await trx('library_items').where({ id_library_item: book.id_library_item }).first();
    expect(after.key).toBe('Part 1.m4b');
  });

  it('keeps reporting a merged uuid as unknown to /status, so the apps re-match it by path', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const survivor = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await createTestMerge(trx, {
      user_id: user.id_user,
      merged_uuid: MERGED,
      into_item_id: survivor.id_library_item,
    });

    const status = await service.getItemsStatus({ ...user, subscriptions: [] } as any, [
      SURVIVOR,
      MERGED,
    ]);

    expect(status.unknown).toEqual([MERGED]);
  });

  it('applies an update sent with a merged uuid to the item it merged into', async () => {
    // Without this, the merged device's progress would be dropped silently
    // (POST / answers 200 either way) until it took the survivor's uuid.
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const survivor = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await createTestMerge(trx, {
      user_id: user.id_user,
      merged_uuid: MERGED,
      into_item_id: survivor.id_library_item,
    });

    const applied = await service.updateObject(
      user as any,
      'Dune.m4b',
      { currentTime: 1234, percentCompleted: 10, lastPlayDateTimestamp: 1795527413 } as any,
      MERGED,
    );

    expect(applied).toBe(true);
    const after = await trx('library_items').where({ id_library_item: survivor.id_library_item }).first();
    expect(Number(after.actual_time)).toBe(1234);
    expect(after.uuid).toBe(SURVIVOR);
  });

  it('deletes the item a merged uuid merged into', async () => {
    // Without this, the delete would answer 200 having changed nothing, and the
    // item would come back on the device's next download.
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const survivor = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await createTestMerge(trx, {
      user_id: user.id_user,
      merged_uuid: MERGED,
      into_item_id: survivor.id_library_item,
    });

    const deleted = await service.deleteObject(user as any, {
      relativePath: 'Dune.m4b',
      uuid: MERGED,
    } as any);

    expect(deleted).toEqual(['Dune.m4b']);
    const after = await trx('library_items').where({ id_library_item: survivor.id_library_item }).first();
    expect(after.active).toBe(false);
  });
});
