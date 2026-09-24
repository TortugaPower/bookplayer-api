import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { SubscriptionTierEnum } from '../../types/user';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * Clients before multipart post `synced:true` even when S3 rejected their PUT,
 * which is how phantom rows (synced, zero bytes) get into production, and LITE
 * clients post it for books that never had a file. Those builds keep shipping
 * to devices stuck below the new iOS minimum, so the server now checks the
 * object before accepting the confirmation, on every tier.
 */
describe('LibraryService.updateObject — synced guard for older clients', () => {
  let service: LibraryService;
  let fileExistsMock: jest.Mock<(...args: any[]) => Promise<boolean | null>>;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    fileExistsMock = jest.fn(async () => false);
    (service as any)._storage = { fileExists: fileExistsMock };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    mockLoggerService.log.mockClear();
  });

  const setup = async (overrides: { type?: number } = {}) => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      synced: false,
      source_path: 'root/20260101000000_Book.m4b',
      ...overrides,
    });
    return { trx, user, item };
  };

  const syncedOf = async (trx: any, id: number) =>
    (await trx('library_items').where({ id_library_item: id }).first()).synced;

  it('keeps a PRO book unsynced when S3 has no object, and still answers success', async () => {
    const { trx, user, item } = await setup();

    const result = await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(result).toBe(true);
    const row = await trx('library_items').where({ id_library_item: item.id_library_item }).first();
    expect(row.synced).toBe(false);
    // The real old-client body carries relativePath, so the update still writes the (same) key.
    expect(row.key).toBe('Book.m4b');
    expect(fileExistsMock).toHaveBeenCalledWith({ key: 'test-prefix/root/20260101000000_Book.m4b' });
  });

  it('accepts the confirmation once the object exists', async () => {
    const { trx, user, item } = await setup();
    fileExistsMock.mockResolvedValueOnce(true);

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(await syncedOf(trx, item.id_library_item)).toBe(true);
  });

  it('keeps the rest of the update when it drops the confirmation', async () => {
    const { trx, user, item } = await setup();

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true, title: 'Renamed' } as any,
      item.uuid,
    );

    const row = await trx('library_items').where({ id_library_item: item.id_library_item }).first();
    expect(row.title).toBe('Renamed');
    expect(row.synced).toBe(false);
  });

  it('guards LITE too: synced means the file is in S3, and LITE never uploads one', async () => {
    // LITE clients get url:null from PUT / and read it as "already stored";
    // accepting that left LITE books synced=true with no bytes, so they never
    // uploaded after the account moved to PRO.
    const { trx, user, item } = await setup();

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.LITE] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(await syncedOf(trx, item.id_library_item)).toBe(false);
  });

  it('still confirms a LITE book whose file was uploaded while the account was PRO', async () => {
    const { trx, user, item } = await setup();
    fileExistsMock.mockResolvedValueOnce(true);

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.LITE] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(await syncedOf(trx, item.id_library_item)).toBe(true);
  });

  it('does not guard folders, which have no object of their own', async () => {
    const { trx, user, item } = await setup({ type: 0 });

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(await syncedOf(trx, item.id_library_item)).toBe(true);
  });

  it('keeps the old behaviour when S3 cannot answer, rather than stalling uploads that landed', async () => {
    const { trx, user, item } = await setup();
    fileExistsMock.mockResolvedValueOnce(null);

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(await syncedOf(trx, item.id_library_item)).toBe(true);
  });

  it('guards clients that name the item by path only, without a uuid', async () => {
    const { trx, user, item } = await setup();

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true } as any,
      undefined,
    );

    expect(await syncedOf(trx, item.id_library_item)).toBe(false);
    expect(fileExistsMock).toHaveBeenCalledWith({ key: 'test-prefix/root/20260101000000_Book.m4b' });
  });

  it('skips the S3 check for a row that is already synced: dropping would change nothing', async () => {
    const { trx, user, item } = await setup();
    await trx('library_items').update({ synced: true }).where({ id_library_item: item.id_library_item });

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { synced: true } as any,
      item.uuid,
    );

    expect(fileExistsMock).not.toHaveBeenCalled();
    expect(await syncedOf(trx, item.id_library_item)).toBe(true);
  });

  it('never checks S3 for updates that do not confirm an upload', async () => {
    const { user, item } = await setup();

    await service.updateObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      'Book.m4b',
      { title: 'Renamed' } as any,
      item.uuid,
    );

    expect(fileExistsMock).not.toHaveBeenCalled();
  });
});

describe('LibraryService.deleteObject — in-flight multipart uploads', () => {
  let service: LibraryService;
  let calls: string[];
  let uploadsUnderPrefix: { key: string; uploadId: string }[] | null;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    calls = [];
    uploadsUnderPrefix = [];
    (service as any)._storage = {
      listMultipartUploads: jest.fn(async (prefix: string) => {
        calls.push(`list ${prefix}`);
        return uploadsUnderPrefix;
      }),
      abortMultipartUpload: jest.fn(async (key: string, id: string) => {
        calls.push(`abort ${key} ${id}`);
        return true;
      }),
      deleteFile: jest.fn(async ({ sourceKey }: { sourceKey: string }) => {
        calls.push(`delete ${sourceKey}`);
        return true;
      }),
    };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
  });

  it('aborts uploads still open for a deleted book before removing it', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      source_path: 'root/20260101000000_Book.m4b',
    });
    const key = 'test-prefix/root/20260101000000_Book.m4b';
    uploadsUnderPrefix = [
      { key, uploadId: 'up-1' },
      // Shares the prefix, not the key: must be left alone.
      { key: `${key}.bak`, uploadId: 'up-other' },
    ];

    await service.deleteObject(user as any, { relativePath: 'Book.m4b', uuid: item.uuid } as any);

    expect(calls).toEqual(['list test-prefix/', `abort ${key} up-1`, `delete ${key}`]);
  });

  it('lists the prefix once for a whole folder, however many books it held', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const folder = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Series', type: 0 });
    for (const name of ['One', 'Two', 'Three']) {
      await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: `Series/${name}.m4b`,
        source_path: `root/2026_${name}.m4b`,
      });
    }
    uploadsUnderPrefix = [{ key: 'test-prefix/root/2026_Two.m4b', uploadId: 'up-2' }];

    await service.deleteObject(user as any, { relativePath: 'Series', uuid: folder.uuid } as any);

    expect(calls.filter((c) => c.startsWith('list'))).toEqual(['list test-prefix/']);
    expect(calls.filter((c) => c.startsWith('abort'))).toEqual(['abort test-prefix/root/2026_Two.m4b up-2']);
    expect(calls.filter((c) => c.startsWith('delete'))).toHaveLength(4);
  });

  it('still deletes when listing open uploads fails', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      source_path: 'root/20260101000000_Book.m4b',
    });
    uploadsUnderPrefix = null;

    await service.deleteObject(user as any, { relativePath: 'Book.m4b', uuid: item.uuid } as any);

    expect(calls).toEqual([
      'list test-prefix/',
      'delete test-prefix/root/20260101000000_Book.m4b',
    ]);
  });
});

/**
 * A legacy row (no source_path) is read at its key everywhere: the synced
 * guard, multipart's resolveTarget, downloads. Its re-upload URL must point
 * there too — a fresh timestamped path is never written back to the row, so
 * the bytes would be orphaned.
 */
describe('LibraryService.putObject — re-uploading a legacy row', () => {
  it('signs the PUT at the key the row already points to', async () => {
    const service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    const getPresignedUrl = jest.fn(async () => ({ url: 'https://s3/put', expires_in: 1 }));
    (service as any)._storage = { fileExists: jest.fn(async () => false), getPresignedUrl };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Folder/Book.m4b',
      source_path: null,
      synced: false,
    });

    const result = await service.putObject(
      { ...user, subscriptions: [SubscriptionTierEnum.PRO] } as any,
      {
        relativePath: 'Folder/Book.m4b',
        originalFileName: 'Book.m4b',
        title: 'Book',
        type: '2',
        uuid: item.uuid,
      } as any,
    );

    expect(result.url).toBe('https://s3/put');
    expect(getPresignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'test-prefix/Folder/Book.m4b' }),
    );
    // Only the URL changes: the row keeps reading from its key.
    const row = await trx('library_items').where({ id_library_item: item.id_library_item }).first();
    expect(row.source_path).toBeNull();
    expect(row.key).toBe('Folder/Book.m4b');
  });
});
