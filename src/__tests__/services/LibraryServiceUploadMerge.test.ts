import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * Same-name merges on upload (docs/same-name-merges.md, step 2). `PUT /` to a
 * key another item already holds used to answer with that item and drop the
 * app's uuid, so the app's next request by its uuid got item_not_found for
 * good. Now an upload of the same kind of item merges into the one already
 * there: that item keeps its uuid, the uploaded uuid becomes a pointer to it,
 * the newer play wins, and the reply lists the merge in the POST /uuids shape.
 */
const SURVIVOR = '11111111-1111-4111-8111-111111111111';
// iOS sends uuids uppercase
const ARRIVING = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const ARRIVING_LOWER = ARRIVING.toLowerCase();
const BOOK = '33333333-3333-4333-8333-333333333333';

describe('LibraryService.putObject — merging into the item at a taken key', () => {
  let service: LibraryService;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    (service as any)._storage = {
      fileExists: jest.fn(async () => false),
      moveFile: jest.fn(async () => true),
      deleteFile: jest.fn(async () => true),
      getPresignedUrl: jest.fn(async () => ({ url: 'https://signed', expires_in: 60 })),
    };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    mockLoggerService.log.mockClear();
  });

  const user = async () => {
    const row = await createTestUser(getTestTransaction());
    return { ...row, subscriptions: [] } as any;
  };

  const upload = (owner: any, fields: Record<string, unknown>) =>
    service.putObject(owner, { title: 'Dune', ...fields } as any);

  const pointers = (userId: number) =>
    getTestTransaction()('library_item_merges').where({ user_id: userId });

  it('merges a book uploaded under a new uuid into the book already at its key', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const survivor = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });

    const { content, conflicts } = await upload(owner, {
      relativePath: 'Dune.m4b',
      uuid: ARRIVING,
      type: 2,
    });

    expect(conflicts).toEqual([{ key: ARRIVING, uuid: SURVIVOR }]);
    expect(content.uuid).toBe(SURVIVOR);
    expect(await pointers(owner.id_user)).toEqual([
      expect.objectContaining({ merged_uuid: ARRIVING_LOWER, into_item_id: survivor.id_library_item }),
    ]);
    const rows = await trx('library_items').where({ user_id: owner.id_user, active: true });
    expect(rows.map((r) => r.uuid)).toEqual([SURVIVOR]);
  });

  it('merges a folder into a bound book with the same name: both are containers', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const survivor = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Series 1',
      type: 1,
      uuid: SURVIVOR,
    });

    const { conflicts } = await upload(owner, { relativePath: 'Series 1', uuid: ARRIVING, type: 0 });

    expect(conflicts).toEqual([{ key: ARRIVING, uuid: SURVIVOR }]);
    const after = await trx('library_items').where({ id_library_item: survivor.id_library_item }).first();
    expect(String(after.type)).toBe('1');
  });

  it('leaves a folder uploaded onto a book with the same name as before: they never merge', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Series/Series.cue',
      type: 2,
      uuid: SURVIVOR,
    });

    const { content, conflicts } = await upload(owner, {
      relativePath: 'Series/Series.cue',
      uuid: ARRIVING,
      type: 0,
    });

    expect(conflicts).toEqual([]);
    expect(content.uuid).toBe(SURVIVOR);
    expect(await pointers(owner.id_user)).toEqual([]);
  });

  it('records no pointer for a uuid that has an active row of its own elsewhere', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Old/Dune.m4b',
      uuid: ARRIVING_LOWER,
    });

    const { conflicts } = await upload(owner, { relativePath: 'Dune.m4b', uuid: ARRIVING, type: 2 });

    expect(conflicts).toEqual([]);
    expect(await pointers(owner.id_user)).toEqual([]);
  });

  it('gives a row from before uuids the uploaded uuid instead of a pointer', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const legacy = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: null,
    });

    const { content, conflicts } = await upload(owner, { relativePath: 'Dune.m4b', uuid: ARRIVING, type: 2 });

    expect(conflicts).toEqual([]);
    expect(content.uuid).toBe(ARRIVING_LOWER);
    const after = await trx('library_items').where({ id_library_item: legacy.id_library_item }).first();
    expect(after.uuid).toBe(ARRIVING_LOWER);
    expect(await pointers(owner.id_user)).toEqual([]);
  });

  it('does not give a row from before uuids the uuid of a different kind of item', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const legacyBook = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Series/Series.cue',
      type: 2,
      uuid: null,
    });

    await upload(owner, { relativePath: 'Series/Series.cue', uuid: ARRIVING, type: 0 });

    const after = await trx('library_items').where({ id_library_item: legacyBook.id_library_item }).first();
    expect(after.uuid).toBeNull();
  });

  it('changes nothing when the upload carries the uuid the item already has', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });

    const { conflicts } = await upload(owner, {
      relativePath: 'Dune.m4b',
      uuid: SURVIVOR.toUpperCase(),
      type: 2,
    });

    expect(conflicts).toEqual([]);
    expect(await pointers(owner.id_user)).toEqual([]);
  });

  it('answers a retried upload the same way, with one pointer', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });

    await upload(owner, { relativePath: 'Dune.m4b', uuid: ARRIVING, type: 2 });
    const { conflicts } = await upload(owner, { relativePath: 'Dune.m4b', uuid: ARRIVING, type: 2 });

    expect(conflicts).toEqual([{ key: ARRIVING, uuid: SURVIVOR }]);
    expect(await pointers(owner.id_user)).toHaveLength(1);
  });

  it('takes the uploaded listening state when it was played after the survivor', async () => {
    // Listened on a flight before the phone synced: that position is the newer one
    const trx = getTestTransaction();
    const owner = await user();
    const survivor = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await trx('library_items')
      .where({ id_library_item: survivor.id_library_item })
      .update({ actual_time: '10', percent_completed: 1, last_play_date: 1000 });

    const { content } = await upload(owner, {
      relativePath: 'Dune.m4b',
      uuid: ARRIVING,
      type: 2,
      currentTime: 500,
      percentCompleted: 40,
      lastPlayDateTimestamp: 2000,
    });

    const after = await trx('library_items').where({ id_library_item: survivor.id_library_item }).first();
    expect(Number(after.actual_time)).toBe(500);
    expect(Number(after.last_play_date)).toBe(2000);
    expect(content.currentTime).toBe(500);
  });

  it('keeps the survivor listening state when it was played after the upload', async () => {
    const trx = getTestTransaction();
    const owner = await user();
    const survivor = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Dune.m4b',
      uuid: SURVIVOR,
    });
    await trx('library_items')
      .where({ id_library_item: survivor.id_library_item })
      .update({ actual_time: '900', percent_completed: 70, last_play_date: 3000 });

    await upload(owner, {
      relativePath: 'Dune.m4b',
      uuid: ARRIVING,
      type: 2,
      currentTime: 500,
      lastPlayDateTimestamp: 2000,
    });

    const after = await trx('library_items').where({ id_library_item: survivor.id_library_item }).first();
    expect(Number(after.actual_time)).toBe(900);
    expect(Number(after.last_play_date)).toBe(3000);
  });

  it('lets the app move a book into its folder after the folder merged on upload', async () => {
    // The stuck case end to end: another device already had the folder, so the
    // app's folder uuid used to be dropped and this move 404'd forever
    const trx = getTestTransaction();
    const owner = await user();
    await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Series 1',
      type: 1,
      uuid: SURVIVOR,
    });
    const book = await createTestLibraryItem(trx, {
      user_id: owner.id_user,
      key: 'Part 1.m4b',
      uuid: BOOK,
    });

    await upload(owner, { relativePath: 'Series 1', uuid: ARRIVING, type: 0 });
    await service.moveLibraryObjectByUuid(owner, { origin: BOOK, destination: ARRIVING });

    const after = await trx('library_items').where({ id_library_item: book.id_library_item }).first();
    expect(after.key).toBe('Series 1/Part 1.m4b');
  });
});
