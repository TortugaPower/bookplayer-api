import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { RESTORE_DAYS, RESTORE_TIER } from '../../services/GlacierRestoreService';
import { LibraryItem, SubscriptionTierEnum } from '../../types/user';
import { ObjectHead } from '../../services/S3Service';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

const APP_VERSION = '2022-12-12'; // the presigned branch every shipped app uses
const PREFIX = 'pfx';
const ARCHIVED_COLD: ObjectHead = { storageClass: 'DEEP_ARCHIVE', restore: 'none', contentLength: 100 };
const ARCHIVED_THAWING: ObjectHead = { storageClass: 'DEEP_ARCHIVE', restore: 'ongoing', contentLength: 100 };
const ARCHIVED_READY: ObjectHead = { storageClass: 'DEEP_ARCHIVE', restore: 'ready', contentLength: 100 };
const WARM: ObjectHead = { storageClass: 'INTELLIGENT_TIERING', restore: 'none', contentLength: 100 };

// createTestLibraryItem stores source_path as root/test_<basename>.
const objectKey = (key: string) => `${PREFIX}/root/test_${key.split('/').pop()}`;

/**
 * On-demand thaw: when a Pro client asks for the signed URL of ONE item, a book
 * sitting in Deep Archive gets a restore requested and recorded; listings never
 * touch S3; nothing here can fail the request.
 */
describe('LibraryService — on-demand Glacier restore hook', () => {
  let service: LibraryService;
  let heads: Record<string, ObjectHead | 'missing' | null>;
  let headObject: jest.Mock;
  let restoreObject: jest.Mock;

  beforeEach(() => {
    service = new LibraryService();
    const trx = getTestTransaction();
    (service as any).db = trx;
    (service as any)._libraryDB.db = trx;
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    (service as any)._prefix = { getPrefix: jest.fn(async () => PREFIX) };
    (service as any)._storage = {
      getPresignedUrl: jest.fn(async ({ key }: { key: string }) => ({ url: `https://signed/${key}`, expires_in: 1 })),
    };
    const glacier = (service as any)._glacier;
    glacier._logger = mockLoggerService;
    glacier._libraryDB.db = trx;
    glacier._libraryDB._logger = mockLoggerService;
    glacier._restoreDB.db = trx;
    glacier._restoreDB._logger = mockLoggerService;
    heads = {};
    headObject = jest.fn(async ({ key }: { key: string }) => (key in heads ? heads[key] : WARM));
    // Behaves like S3: once a restore is requested the object reads as thawing,
    // so a later HEAD (e.g. from a background walk) no longer sees it cold.
    restoreObject = jest.fn(async ({ key }: { key: string }) => {
      const current = heads[key];
      if (current && current !== 'missing' && current.restore === 'none') {
        heads[key] = { ...current, restore: 'ongoing' };
      }
      return true;
    });
    glacier._storage = { headObject, restoreObject };
    mockLoggerService.log.mockClear();
  });

  const drain = () => (service as any)._glacier.drain();
  const rows = (userId: number) => (service as any)._glacier._restoreDB.getByUser(userId);

  function get(
    user: { id_user: number; email: string },
    relativePath: string,
    uuid?: string,
    tier: string = SubscriptionTierEnum.PRO,
  ): Promise<LibraryItem[]> {
    return service.getLibrary(
      { ...user, subscriptions: [tier] } as any,
      `${user.email}/${relativePath}`,
      { appVersion: APP_VERSION, withPresign: true },
      uuid,
    );
  }

  //   Solo.m4b            Folder/a.m4b            Series/ (bound): 01.mp3 (with artwork), 02.mp3, 03.mp3
  async function seed(userId: number) {
    const trx = getTestTransaction();
    const solo = await createTestLibraryItem(trx, { user_id: userId, key: 'Solo.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Folder', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Folder/a.m4b' });
    const series = await createTestLibraryItem(trx, { user_id: userId, key: 'Series', type: 1 });
    const ch1 = await createTestLibraryItem(trx, { user_id: userId, key: 'Series/01.mp3' });
    await trx('library_items').where({ id_library_item: ch1.id_library_item }).update({ thumbnail: 'cover.jpg' });
    const ch2 = await createTestLibraryItem(trx, { user_id: userId, key: 'Series/02.mp3' });
    const ch3 = await createTestLibraryItem(trx, { user_id: userId, key: 'Series/03.mp3' });
    return { solo, series, ch1, ch2, ch3 };
  }

  it('a folder listing never touches S3', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const items = await get(user, 'Folder/');
    await drain();

    expect(items.map((i) => i.relativePath)).toEqual(['Folder/a.m4b']);
    expect(headObject).not.toHaveBeenCalled();
    expect(items[0].storageState).toBeUndefined();
  });

  it('the root listing never touches S3 either', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    await get(user, '');
    await drain();

    expect(headObject).not.toHaveBeenCalled();
  });

  it('a frozen book requested by path gets a Standard restore for RESTORE_DAYS and a request row', async () => {
    const user = await createTestUser(getTestTransaction());
    const { solo } = await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBe('restoring');
    expect(item.url).toContain('Solo.m4b'); // the URL still goes out as before
    expect(restoreObject).toHaveBeenCalledWith({ key: objectKey('Solo.m4b'), days: RESTORE_DAYS, tier: RESTORE_TIER });
    expect(RESTORE_TIER).toBe('Standard');
    const saved = await rows(user.id_user);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      key: objectKey('Solo.m4b'),
      kind: 'object',
      state: 'requested',
      attempts: 1,
      tier: 'Standard',
      days: RESTORE_DAYS,
      library_item_id: solo.id_library_item,
    });
  });

  it('the same by uuid', async () => {
    const user = await createTestUser(getTestTransaction());
    const { solo } = await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    const [item] = await get(user, 'stale/path.m4b', solo.uuid);
    await drain();

    expect(item.storageState).toBe('restoring');
    expect(restoreObject).toHaveBeenCalledTimes(1);
  });

  it('a warm book is reported available and nothing is requested or recorded', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBe('available');
    expect(restoreObject).not.toHaveBeenCalled();
    expect(await rows(user.id_user)).toHaveLength(0);
  });

  it('a book already thawing is recorded (so a hand-run restore gets finalized) but not re-requested', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_THAWING;

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBe('restoring');
    expect(restoreObject).not.toHaveBeenCalled();
    expect(await rows(user.id_user)).toHaveLength(1);
  });

  it('a thawed copy that is ready reads as available and is recorded so the finalizer makes it permanent', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_READY;

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBe('available');
    expect(restoreObject).not.toHaveBeenCalled();
    // A hand-run restore that finished, or one whose row was lost: without a
    // row the copy would expire after RESTORE_DAYS and the book would refreeze.
    expect(await rows(user.id_user)).toHaveLength(1);
  });

  it('a root listing with exactly one top-level item is still a listing: no HEAD', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Only.m4b' });
    heads[objectKey('Only.m4b')] = ARCHIVED_COLD;

    const items = await get(user, '');
    await drain();

    expect(items.map((i) => i.relativePath)).toEqual(['Only.m4b']);
    expect(headObject).not.toHaveBeenCalled();
    expect(items[0].storageState).toBeUndefined();
  });

  it('a warm chapter of a bound book costs exactly one HEAD: no sibling walk', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const [item] = await get(user, 'Series/02.mp3');
    await drain();

    expect(item.storageState).toBe('available');
    expect(headObject).toHaveBeenCalledTimes(1);
    expect(restoreObject).not.toHaveBeenCalled();
  });

  it('a chapter already thawing is recorded but does not re-walk the book', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Series/02.mp3')] = ARCHIVED_THAWING;
    heads[objectKey('Series/01.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD;

    const [item] = await get(user, 'Series/02.mp3');
    await drain();

    expect(item.storageState).toBe('restoring');
    expect(headObject).toHaveBeenCalledTimes(1); // the first tap already walked the book
    expect(restoreObject).not.toHaveBeenCalled();
    expect(await rows(user.id_user)).toHaveLength(1);
  });

  it('a warm bound book resolved as a container costs one probe HEAD', async () => {
    const user = await createTestUser(getTestTransaction());
    const { series } = await seed(user.id_user);

    await get(user, 'Series', series.uuid);
    await drain();

    expect(headObject).toHaveBeenCalledTimes(1);
    expect(restoreObject).not.toHaveBeenCalled();
  });

  it("a frozen bound book's own cover is thawed along with its chapters", async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const { series } = await seed(user.id_user);
    await trx('library_items').where({ id_library_item: series.id_library_item }).update({ thumbnail: 'series.jpg' });
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[`${PREFIX}_thumbnail/series.jpg`] = ARCHIVED_COLD;

    await get(user, 'Series/02.mp3');
    await drain();

    const requestedKeys = restoreObject.mock.calls.map((c: any[]) => c[0].key);
    expect(requestedKeys).toContain(`${PREFIX}_thumbnail/series.jpg`);
    const saved = await rows(user.id_user);
    expect(saved.find((r: any) => r.kind === 'thumbnail')?.library_item_id).toBe(series.id_library_item);
  });

  it('two chapters of the same frozen book tapped at once walk the book once', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Series/01.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD;

    await Promise.all([get(user, 'Series/01.mp3'), get(user, 'Series/02.mp3')]);
    await drain();

    // Each chapter restored once: the two tapped ones in the foreground, the
    // third by whichever walk ran; the second walk was skipped.
    const restoredKeys = restoreObject.mock.calls.map((c: any[]) => c[0].key).sort();
    expect(restoredKeys).toEqual(
      [objectKey('Series/01.mp3'), objectKey('Series/02.mp3'), objectKey('Series/03.mp3')].sort(),
    );
  });

  it("another user's identically named bound book is never touched", async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const other = await createTestUser(trx, { email: `other-${Date.now()}@example.com` });
    await seed(user.id_user);
    const otherSeries = await createTestLibraryItem(trx, { user_id: other.id_user, key: 'Series', type: 1 });
    const otherCh = await createTestLibraryItem(trx, { user_id: other.id_user, key: 'Series/02.mp3' });
    heads[objectKey('Series/01.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD;

    await get(user, 'Series/01.mp3');
    await drain();

    const saved = await rows(user.id_user);
    expect(saved.every((r: any) => r.user_id === user.id_user)).toBe(true);
    expect(saved.map((r: any) => r.library_item_id)).not.toContain(otherCh.id_library_item);
    expect(saved.map((r: any) => r.library_item_id)).not.toContain(otherSeries.id_library_item);
    expect(await rows(other.id_user)).toHaveLength(0);
  });

  it('a failed or 404 HEAD changes nothing: no state, no restore, the URL still returned', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    heads[objectKey('Solo.m4b')] = null;
    let [item] = await get(user, 'Solo.m4b');
    expect(item.storageState).toBeUndefined();
    expect(item.url).toContain('Solo.m4b');

    heads[objectKey('Solo.m4b')] = 'missing';
    [item] = await get(user, 'Solo.m4b');
    await drain();
    expect(item.storageState).toBeUndefined();
    expect(restoreObject).not.toHaveBeenCalled();
    expect(await rows(user.id_user)).toHaveLength(0);
  });

  it('a restore request S3 refused is not recorded and not reported as restoring', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;
    restoreObject.mockImplementation(async () => null);

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBeUndefined();
    expect(item.url).toContain('Solo.m4b');
    expect(await rows(user.id_user)).toHaveLength(0);
  });

  it('repeated taps while thawing keep one row; a finalized row is re-opened on the next freeze', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    await get(user, 'Solo.m4b');
    await get(user, 'Solo.m4b');
    await drain();
    let [row] = await rows(user.id_user);
    expect(row.attempts).toBe(1);

    await trx('glacier_restore_requests')
      .where({ id_glacier_restore_request: row.id_glacier_restore_request })
      .update({ state: 'finalized', finalized_at: trx.fn.now() });
    await get(user, 'Solo.m4b');
    await drain();
    [row] = await rows(user.id_user);
    expect(row).toMatchObject({ state: 'requested', attempts: 2, finalized_at: null });
  });

  it('a restore issued for a row still open (the thawed copy expired unfinalized) reads as a fresh request', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    await get(user, 'Solo.m4b');
    await drain();
    const [first] = await rows(user.id_user);
    expect(first.attempts).toBe(1);

    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD; // window closed: S3 reads cold again
    await get(user, 'Solo.m4b');
    await drain();
    const [second] = await rows(user.id_user);
    expect(restoreObject).toHaveBeenCalledTimes(2);
    expect(second.attempts).toBe(2);
    expect(new Date(second.requested_at).getTime()).toBeGreaterThanOrEqual(new Date(first.requested_at).getTime());
  });

  it('a restore that could not be recorded is still reported as restoring, and logged at error', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;
    (service as any)._glacier._restoreDB.upsertRequested = jest.fn<any>(async (): Promise<null> => null);

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBe('restoring');
    expect(restoreObject).toHaveBeenCalledTimes(1);
    const errors = (mockLoggerService.log.mock.calls as any[][]).filter((c) => c[1] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0][0].origin).toBe('GlacierRestoreService.ensureObject');
    expect(JSON.stringify(errors[0][0])).not.toContain(PREFIX);
  });

  it('a check that outruns its budget answers without a state, and still finishes in the background', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;
    (service as any)._glacier._budgetMs = 20;
    headObject.mockImplementation(
      ({ key }: { key: string }): Promise<ObjectHead | 'missing' | null> =>
        new Promise((resolve) => setTimeout(() => resolve(key in heads ? heads[key] : WARM), 80)),
    );

    const [item] = await get(user, 'Solo.m4b');
    expect(item.url).toContain('Solo.m4b');
    expect(item.storageState).toBeUndefined();
    expect(restoreObject).not.toHaveBeenCalled();

    await drain();
    expect(restoreObject).toHaveBeenCalledTimes(1);
    expect(await rows(user.id_user)).toHaveLength(1);
  });

  it('tapping one chapter of a bound book restores its siblings and artwork in the background', async () => {
    const user = await createTestUser(getTestTransaction());
    const { ch1, ch2, ch3 } = await seed(user.id_user);
    heads[objectKey('Series/01.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_THAWING; // already thawing: recorded, not re-requested
    heads[`${PREFIX}_thumbnail/cover.jpg`] = ARCHIVED_COLD;

    const [item] = await get(user, 'Series/01.mp3');
    expect(item.storageState).toBe('restoring');
    await drain();

    const requestedKeys = restoreObject.mock.calls.map((c: any[]) => c[0].key).sort();
    expect(requestedKeys).toEqual(
      [objectKey('Series/01.mp3'), objectKey('Series/02.mp3'), `${PREFIX}_thumbnail/cover.jpg`].sort(),
    );
    const saved = await rows(user.id_user);
    expect(saved.map((r: any) => [r.key, r.kind, r.library_item_id]).sort()).toEqual(
      [
        [objectKey('Series/01.mp3'), 'object', ch1.id_library_item],
        [objectKey('Series/02.mp3'), 'object', ch2.id_library_item],
        [objectKey('Series/03.mp3'), 'object', ch3.id_library_item],
        [`${PREFIX}_thumbnail/cover.jpg`, 'thumbnail', ch1.id_library_item],
      ].sort(),
    );
    // Solo and Folder/a were never looked at.
    expect(headObject.mock.calls.some((c: any[]) => c[0].key === objectKey('Solo.m4b'))).toBe(false);
  });

  it('a bound book resolved by uuid (no slash) restores its files', async () => {
    const user = await createTestUser(getTestTransaction());
    const { series } = await seed(user.id_user);
    heads[objectKey('Series/01.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD;

    const [item] = await get(user, 'Series', series.uuid);
    await drain();

    expect(item.relativePath).toBe('Series');
    expect(item.storageState).toBeUndefined(); // a folder has no object of its own
    expect(restoreObject).toHaveBeenCalledTimes(3);
  });

  it('a container tap whose first file cannot be checked probes the next one, and each file is HEADed once', async () => {
    const user = await createTestUser(getTestTransaction());
    const { series } = await seed(user.id_user);
    heads[objectKey('Series/01.mp3')] = 'missing'; // says nothing about the book
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD;

    await get(user, 'Series', series.uuid);
    await drain();

    const requestedKeys = restoreObject.mock.calls.map((c: any[]) => c[0].key).sort();
    expect(requestedKeys).toEqual([objectKey('Series/02.mp3'), objectKey('Series/03.mp3')]);
    const headed = headObject.mock.calls.map((c: any[]) => c[0].key);
    expect(headed.filter((k: string) => k === objectKey('Series/01.mp3'))).toHaveLength(1);
  });

  it('a container tap probes synced files before unsynced ones', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const { series, ch1 } = await seed(user.id_user);
    await trx('library_items').where({ id_library_item: ch1.id_library_item }).update({ synced: false });
    heads[objectKey('Series/01.mp3')] = 'missing';
    heads[objectKey('Series/02.mp3')] = ARCHIVED_COLD;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD;

    await get(user, 'Series', series.uuid);
    await drain();

    expect((headObject.mock.calls[0][0] as any).key).toBe(objectKey('Series/02.mp3'));
    expect(restoreObject).toHaveBeenCalledTimes(2);
  });

  it('a container tap stops at the first definitive answer: a warm file means the book was not frozen', async () => {
    const user = await createTestUser(getTestTransaction());
    const { series } = await seed(user.id_user);
    heads[objectKey('Series/01.mp3')] = 'missing';
    heads[objectKey('Series/02.mp3')] = WARM;
    heads[objectKey('Series/03.mp3')] = ARCHIVED_COLD; // never reached

    await get(user, 'Series', series.uuid);
    await drain();

    expect(headObject).toHaveBeenCalledTimes(2);
    expect(restoreObject).not.toHaveBeenCalled();
  });

  it('a container tap gives up after a few unanswerable probes', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const { series } = await seed(user.id_user);
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Series/04.mp3' });
    heads[objectKey('Series/01.mp3')] = 'missing';
    heads[objectKey('Series/02.mp3')] = 'missing';
    heads[objectKey('Series/03.mp3')] = null; // HEAD failed
    heads[objectKey('Series/04.mp3')] = ARCHIVED_COLD;

    await get(user, 'Series', series.uuid);
    await drain();

    expect(headObject).toHaveBeenCalledTimes(3);
    expect(restoreObject).not.toHaveBeenCalled();
  });

  it("a frozen bound book tapped as a container also thaws the book's own cover", async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const { series } = await seed(user.id_user);
    await trx('library_items').where({ id_library_item: series.id_library_item }).update({ thumbnail: 'series.jpg' });
    heads[objectKey('Series/01.mp3')] = ARCHIVED_COLD;
    heads[`${PREFIX}_thumbnail/series.jpg`] = ARCHIVED_COLD;

    await get(user, 'Series', series.uuid);
    await drain();

    expect(restoreObject.mock.calls.map((c: any[]) => c[0].key)).toContain(`${PREFIX}_thumbnail/series.jpg`);
  });

  it('a one-chapter bound book still gets its cover thawed when that chapter is tapped', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await seed(user.id_user);
    const single = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Single', type: 1 });
    await trx('library_items').where({ id_library_item: single.id_library_item }).update({ thumbnail: 'single.jpg' });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Single/01.mp3' });
    heads[objectKey('Single/01.mp3')] = ARCHIVED_COLD;
    heads[`${PREFIX}_thumbnail/single.jpg`] = ARCHIVED_COLD;

    const [item] = await get(user, 'Single/01.mp3');
    expect(item.storageState).toBe('restoring');
    await drain();

    expect(restoreObject.mock.calls.map((c: any[]) => c[0].key).sort()).toEqual(
      [objectKey('Single/01.mp3'), `${PREFIX}_thumbnail/single.jpg`].sort(),
    );
  });

  it('a legacy row with a NULL type is a file: a frozen one gets a restore', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const { solo } = await seed(user.id_user);
    await trx('library_items').where({ id_library_item: solo.id_library_item }).update({ type: null });
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    const [item] = await get(user, 'Solo.m4b');
    await drain();

    expect(item.storageState).toBe('restoring');
    expect(restoreObject).toHaveBeenCalledTimes(1);
  });

  it('a plain folder resolved by uuid is never checked', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await seed(user.id_user);
    const folder = (await trx('library_items').where({ user_id: user.id_user, key: 'Folder' }).first()) as any;
    heads[objectKey('Folder/a.m4b')] = ARCHIVED_COLD;

    await get(user, 'Folder', folder.uuid);
    await drain();

    expect(headObject).not.toHaveBeenCalled();
  });

  it('the resume item riding along with the root sync is never checked', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const { solo } = await seed(user.id_user);
    await trx('library_items').where({ id_library_item: solo.id_library_item }).update({ last_play_date: 1700000000 });
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    const item = await service.getLastItemPlayed(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      { appVersion: APP_VERSION, withPresign: true },
    );
    await drain();

    expect(item?.url).toContain('Solo.m4b');
    expect(item?.storageState).toBeUndefined();
    expect(headObject).not.toHaveBeenCalled();
  });

  it('a non-PRO caller never triggers a HEAD', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);
    heads[objectKey('Solo.m4b')] = ARCHIVED_COLD;

    await get(user, 'Solo.m4b', undefined, SubscriptionTierEnum.LITE);
    await drain();

    expect(headObject).not.toHaveBeenCalled();
  });
});
