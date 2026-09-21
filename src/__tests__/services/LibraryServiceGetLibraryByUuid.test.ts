import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService, LibraryLookupError } from '../../services/LibraryService';
import { LibraryItem, StorageAction, SubscriptionTierEnum } from '../../types/user';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

// A pre-2023 accept-version so getLibrary takes the presign branch the apps
// actually use; the value itself is irrelevant to resolution.
const APP_VERSION = '2022-12-12';
const NOT_A_UUID = 'Optional("2c2d0f44-1111-4111-8111-111111111111")';

function paths(items: LibraryItem[]): string[] {
  return items.map((i) => i.relativePath).sort();
}

/**
 * GET /v1/library resolution contract — pinned so clients can move from
 * relativePath to uuid as the item key:
 *   - a valid uuid identifies the item and never falls back to the path
 *   - a trailing slash on relativePath asks for the item's CONTENTS
 *   - a container's contents are listed by its server-side key, not the path
 *     the client sent (which is what goes stale on move/rename)
 *   - no uuid, or a malformed one, keeps the historical path lookup
 */
describe('LibraryService.getLibrary — uuid resolution', () => {
  let service: LibraryService;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  // Mirrors LibraryController.getLibraryContentPath: the controller prefixes
  // the client's relativePath with the account email before calling the service.
  function get(
    user: { id_user: number; email: string },
    relativePath: string,
    uuid?: string,
    options: { withPresign?: boolean; subscriptions?: string[] } = {},
  ) {
    const reqUser = { ...user, subscriptions: options.subscriptions };
    return service.getLibrary(
      reqUser as any,
      `${user.email}/${relativePath}`,
      { appVersion: APP_VERSION, withPresign: options.withPresign },
      uuid,
    );
  }

  // Library used by most cases:
  //   New Name/            (folder, renamed from "Old Name" on another device)
  //     A.m4b  B.m4b
  //     Sub/   (folder)  -> Sub/C.m4b (a grandchild, must not leak into listings)
  //   Old Name/            (decoy at the stale path)
  //     Z.m4b
  //   Series/              (bound book)
  //     01.mp3  02.mp3  03.mp3 (inactive)
  //   Renamed/Book.m4b     (a single book, moved from "Old/Book.m4b")
  async function seedLibrary(userId: number) {
    const trx = getTestTransaction();
    const folder = await createTestLibraryItem(trx, { user_id: userId, key: 'New Name', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'New Name/A.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'New Name/B.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'New Name/Sub', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'New Name/Sub/C.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Old Name', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Old Name/Z.m4b' });
    const bound = await createTestLibraryItem(trx, { user_id: userId, key: 'Series', type: 1 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Series/01.mp3' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Series/02.mp3' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Series/03.mp3', active: false });
    const book = await createTestLibraryItem(trx, { user_id: userId, key: 'Renamed/Book.m4b' });
    return { folder, bound, book };
  }

  it('a book uuid returns that book even when the client sends its stale path', async () => {
    const user = await createTestUser(getTestTransaction());
    const { book } = await seedLibrary(user.id_user);

    const items = await get(user, 'Old/Book.m4b', book.uuid);

    expect(paths(items)).toEqual(['Renamed/Book.m4b']);
    expect(items[0].uuid).toBe(book.uuid);
  });

  it('a folder uuid with a trailing slash lists the children of the folder\'s SERVER key, ignoring the stale path', async () => {
    const user = await createTestUser(getTestTransaction());
    const { folder } = await seedLibrary(user.id_user);

    // The client still believes the folder is called "Old Name"; a decoy folder
    // exists there so a path-based lookup would return the wrong children.
    const items = await get(user, 'Old Name/', folder.uuid);

    expect(paths(items)).toEqual(['New Name/A.m4b', 'New Name/B.m4b', 'New Name/Sub']);
    // Direct children only: the grandchild stays out, and so does the folder itself.
    expect(paths(items)).not.toContain('New Name/Sub/C.m4b');
    expect(paths(items)).not.toContain('New Name');
  });

  it('a bound-book uuid with a trailing slash lists its active files only', async () => {
    const user = await createTestUser(getTestTransaction());
    const { bound } = await seedLibrary(user.id_user);

    const items = await get(user, 'Series/', bound.uuid);

    expect(paths(items)).toEqual(['Series/01.mp3', 'Series/02.mp3']);
    expect(items.every((i) => Number(i.type) === 2)).toBe(true);
  });

  it('a folder uuid WITHOUT a trailing slash returns the folder row itself (unchanged behaviour)', async () => {
    const user = await createTestUser(getTestTransaction());
    const { folder } = await seedLibrary(user.id_user);

    expect(paths(await get(user, 'whatever', folder.uuid))).toEqual(['New Name']);
    // An empty relativePath is not a contents request either: only the slash is.
    const items = await get(user, '', folder.uuid);
    expect(paths(items)).toEqual(['New Name']);
    expect(Number(items[0].type)).toBe(0);
  });

  it('a row with a NULL type is not a container: uuid + trailing slash returns the row itself', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '77777777-7777-4777-8777-777777777777';
    // Legacy rows can carry type = NULL; createTestLibraryItem always sets one.
    await trx('library_items').insert({
      user_id: user.id_user,
      key: 'Untyped',
      title: 'Untyped',
      original_filename: 'Untyped',
      speed: 1,
      actual_time: '0',
      details: '',
      duration: '0',
      percent_completed: 0,
      order_rank: 0,
      type: null,
      is_finish: false,
      thumbnail: null,
      source_path: 'root/test_Untyped',
      synced: true,
      active: true,
      uuid,
    });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Untyped/child.m4b' });

    const items = await get(user, 'Untyped/', uuid);

    expect(paths(items)).toEqual(['Untyped']);
  });

  it('a book uuid with a trailing slash still returns the book — books have no contents', async () => {
    const user = await createTestUser(getTestTransaction());
    const { book } = await seedLibrary(user.id_user);

    const items = await get(user, 'Renamed/Book.m4b/', book.uuid);

    expect(paths(items)).toEqual(['Renamed/Book.m4b']);
  });

  it('a valid uuid that matches nothing returns [] and does NOT fall back to the path', async () => {
    const user = await createTestUser(getTestTransaction());
    await seedLibrary(user.id_user);

    const items = await get(user, 'Old Name/', '99999999-9999-4999-8999-999999999999');

    expect(items).toEqual([]);
  });

  it('a uuid belonging to another user resolves to nothing', async () => {
    const trx = getTestTransaction();
    const owner = await createTestUser(trx);
    const stranger = await createTestUser(trx, { email: `stranger-${Date.now()}@example.com` });
    const { folder } = await seedLibrary(owner.id_user);

    const items = await get(stranger, 'New Name/', folder.uuid);

    expect(items).toEqual([]);
  });

  it('a malformed uuid (what iOS sent before 2026-09) falls back to the path lookup', async () => {
    const user = await createTestUser(getTestTransaction());
    await seedLibrary(user.id_user);

    const items = await get(user, 'New Name/', NOT_A_UUID);

    expect(paths(items)).toEqual(['New Name/A.m4b', 'New Name/B.m4b', 'New Name/Sub']);
    // …and says so, at a level prod ships, without logging the user.
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'LibraryService.getLibrary',
        data: { uuid: NOT_A_UUID },
      }),
      'warn',
    );
  });

  it('the malformed-uuid warning is throttled: one line per service instance per window', async () => {
    const user = await createTestUser(getTestTransaction());
    await seedLibrary(user.id_user);

    await get(user, 'New Name/', NOT_A_UUID);
    await get(user, 'New Name/', NOT_A_UUID);
    await get(user, 'Renamed/Book.m4b', 'Optional("another-bad-one")');

    const warns = (mockLoggerService.log.mock.calls as any[][]).filter((c) => c[1] === 'warn');
    expect(warns).toHaveLength(1);
  });

  it('a failed lookup logs identifiers only, never the user object', async () => {
    const user = await createTestUser(getTestTransaction());
    (service as any)._libraryDB.getLibrary = jest.fn(async () => null);

    await expect(get(user, 'New Name/')).rejects.toBeInstanceOf(LibraryLookupError);

    const errors = (mockLoggerService.log.mock.calls as any[][]).filter((c) => c[1] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0][0].data).toEqual({ user_id: user.id_user, relativePath: 'New Name/' });
    // The controller hands the service an email-prefixed path; it must not leak.
    expect(JSON.stringify(errors[0][0])).not.toContain('@');
  });

  it('a well-formed or absent uuid produces no malformed-uuid warning', async () => {
    const user = await createTestUser(getTestTransaction());
    const { book } = await seedLibrary(user.id_user);

    await get(user, 'Renamed/Book.m4b', book.uuid);
    await get(user, 'New Name/');

    expect(mockLoggerService.log).not.toHaveBeenCalledWith(expect.anything(), 'warn');
  });

  it('no uuid keeps the historical path lookup for contents and for a single item', async () => {
    const user = await createTestUser(getTestTransaction());
    await seedLibrary(user.id_user);

    expect(paths(await get(user, 'Old Name/'))).toEqual(['Old Name/Z.m4b']);
    expect(paths(await get(user, 'Renamed/Book.m4b'))).toEqual(['Renamed/Book.m4b']);
  });

  it('children resolved through a uuid are presigned by their own server keys', async () => {
    const user = await createTestUser(getTestTransaction());
    const { bound } = await seedLibrary(user.id_user);
    const getPrefix = jest.fn<() => Promise<string>>().mockResolvedValue('ext-abc');
    const getPresignedUrl = jest
      .fn<(params: { key: string; type: StorageAction }) => Promise<{ url: string }>>()
      .mockImplementation(async ({ key }) => ({ url: `https://signed.example/${key}` }));
    (service as any)._prefix = { getPrefix };
    (service as any)._storage = { getPresignedUrl };

    const items = await get(user, 'Old Series Name/', bound.uuid, {
      withPresign: true,
      subscriptions: [SubscriptionTierEnum.PRO],
    });

    expect(paths(items)).toEqual(['Series/01.mp3', 'Series/02.mp3']);
    // createTestLibraryItem stores source_path as root/test_<basename>.
    expect(items.map((i) => i.url).sort()).toEqual([
      'https://signed.example/ext-abc/root/test_01.mp3',
      'https://signed.example/ext-abc/root/test_02.mp3',
    ]);
    for (const call of getPresignedUrl.mock.calls) {
      expect(call[0].type).toBe(StorageAction.GET);
      expect(call[0].key).not.toContain('Old Series Name');
    }
  });

  it('LIKE wildcards in a key are literal: `A_B/` and `100%/` list only their own children', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const underscore = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'A_B', type: 0 });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'A_B/one.m4b' });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'AxB', type: 0 });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: 'AxB/two.m4b' });
    const percent = await createTestLibraryItem(trx, { user_id: user.id_user, key: '100%', type: 0 });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: '100%/three.m4b' });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: '100 percent', type: 0 });
    await createTestLibraryItem(trx, { user_id: user.id_user, key: '100 percent/four.m4b' });

    // Through the uuid branch (server key) and through the historical path branch.
    expect(paths(await get(user, 'stale/', underscore.uuid))).toEqual(['A_B/one.m4b']);
    expect(paths(await get(user, 'A_B/'))).toEqual(['A_B/one.m4b']);
    expect(paths(await get(user, 'stale/', percent.uuid))).toEqual(['100%/three.m4b']);
    expect(paths(await get(user, '100%/'))).toEqual(['100%/three.m4b']);
  });

  describe('a failed lookup is an error, never an empty library', () => {
    // The DB layer logs and returns null when a query fails. A sync client
    // treats an empty contents listing as authoritative, so null must not
    // become `[]`.
    it('when the uuid lookup fails', async () => {
      const user = await createTestUser(getTestTransaction());
      const { folder } = await seedLibrary(user.id_user);
      (service as any)._libraryDB.getLibraryByUuid = jest.fn(async () => null);

      await expect(get(user, 'New Name/', folder.uuid)).rejects.toBeInstanceOf(LibraryLookupError);
    });

    it('when the children lookup fails', async () => {
      const user = await createTestUser(getTestTransaction());
      const { folder } = await seedLibrary(user.id_user);
      (service as any)._libraryDB.getLibrary = jest.fn(async () => null);

      await expect(get(user, 'New Name/', folder.uuid)).rejects.toBeInstanceOf(LibraryLookupError);
    });

    it('when the path lookup fails', async () => {
      const user = await createTestUser(getTestTransaction());
      await seedLibrary(user.id_user);
      (service as any)._libraryDB.getLibrary = jest.fn(async () => null);

      await expect(get(user, 'New Name/')).rejects.toBeInstanceOf(LibraryLookupError);
    });
  });
});
