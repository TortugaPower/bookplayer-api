import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { LibraryItem, LibraryItemType } from '../../types/user';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

// putObject params as the iOS client sends them for an upload task.
function makeUploadParams(overrides: Partial<LibraryItem> = {}): LibraryItem {
  const relativePath = overrides.relativePath || 'Book.m4b';
  const baseName = relativePath.split('/').pop();
  return {
    relativePath,
    originalFileName: baseName,
    title: baseName,
    details: 'Test Author',
    speed: 1,
    currentTime: 0,
    duration: 100,
    percentCompleted: 0,
    isFinished: false,
    orderRank: 0,
    type: LibraryItemType.BOOK,
    ...overrides,
  } as LibraryItem;
}

describe('LibraryService.putObject — uuid fallback (treat as move)', () => {
  let service: LibraryService;
  let fileExistsMock: jest.Mock;

  beforeEach(() => {
    service = new LibraryService();
    // Route the service's own this.db.transaction() through the test trx so its
    // nested commit/rollback only releases a savepoint; afterEach rolls back the
    // outer transaction and discards everything.
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
    fileExistsMock = jest.fn(async () => false);
    (service as any)._storage = { fileExists: fileExistsMock };
    (service as any)._prefix = { getPrefix: jest.fn(async () => 'test-prefix') };
    mockLoggerService.log.mockClear();
  });

  it('moves a book to the new key instead of inserting a duplicate uuid', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '11111111-1111-4111-8111-111111111111';
    const book = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      uuid,
      source_path: 'root/20260101000000_Book.m4b',
    });

    const result = await service.putObject(
      user as any,
      makeUploadParams({ relativePath: '0_FINISHED/Book.m4b', uuid }),
    );

    expect(result.relativePath).toBe('0_FINISHED/Book.m4b');

    const rows = await trx('library_items').where({
      user_id: user.id_user,
      active: true,
      uuid,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id_library_item).toBe(book.id_library_item);
    expect(rows[0].key).toBe('0_FINISHED/Book.m4b');
    // The move must not touch the S3 linkage
    expect(rows[0].source_path).toBe('root/20260101000000_Book.m4b');
  });

  it('returns the early "already in storage" response after moving when the S3 file exists', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '22222222-2222-4222-8222-222222222222';
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      uuid,
      source_path: 'root/20260101000000_Book.m4b',
    });
    fileExistsMock.mockResolvedValue(true as never);

    const result = await service.putObject(
      user as any,
      makeUploadParams({ relativePath: '0_FINISHED/Book.m4b', uuid }),
    );

    // Early return: no upload url, and the item reflects the new key
    expect(result.url).toBeNull();
    expect(result.relativePath).toBe('0_FINISHED/Book.m4b');
    expect(fileExistsMock).toHaveBeenCalledWith({
      key: 'test-prefix/root/20260101000000_Book.m4b',
    });
  });

  it('moves a folder together with its children', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '33333333-3333-4333-8333-333333333333';
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series',
      type: 0,
      uuid,
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series/a.m4b',
      uuid: '33333333-3333-4333-8333-00000000000a',
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series/b.m4b',
      uuid: '33333333-3333-4333-8333-00000000000b',
    });

    await service.putObject(
      user as any,
      makeUploadParams({ relativePath: '0_FINISHED/Series', uuid, type: LibraryItemType.FOLDER }),
    );

    const keys = (
      await trx('library_items')
        .where({ user_id: user.id_user, active: true })
        .orderBy('key')
    ).map((r) => r.key);
    expect(keys).toEqual([
      '0_FINISHED/Series',
      '0_FINISHED/Series/a.m4b',
      '0_FINISHED/Series/b.m4b',
    ]);
  });

  it('keeps destination children and deactivates stale old-path children on collision', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const folderUuid = '44444444-4444-4444-8444-444444444444';
    const staleChildUuid = '44444444-4444-4444-8444-00000000000a';
    const destChildUuid = '44444444-4444-4444-8444-00000000000b';
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series',
      type: 0,
      uuid: folderUuid,
    });
    const staleChild = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Series/a.m4b',
      uuid: staleChildUuid,
    });
    // The client already re-created this child at the destination (Capone shape)
    const destChild = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: '0_FINISHED/Series/a.m4b',
      uuid: destChildUuid,
    });

    await service.putObject(
      user as any,
      makeUploadParams({ relativePath: '0_FINISHED/Series', uuid: folderUuid, type: LibraryItemType.FOLDER }),
    );

    const staleRow = await trx('library_items')
      .where({ id_library_item: staleChild.id_library_item })
      .first();
    expect(staleRow.active).toBe(false);
    expect(staleRow.uuid).toBeNull();

    const destRow = await trx('library_items')
      .where({ id_library_item: destChild.id_library_item })
      .first();
    expect(destRow.active).toBe(true);
    expect(destRow.uuid).toBe(destChildUuid);
    expect(destRow.key).toBe('0_FINISHED/Series/a.m4b');
  });

  it('does not drag LIKE-wildcard sibling folders along (underscore in key)', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '55555555-5555-4555-8555-555555555555';
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'My_Books',
      type: 0,
      uuid,
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'My_Books/a.m4b',
      uuid: '55555555-5555-4555-8555-00000000000a',
    });
    // `_` in LIKE matches any char: an unescaped pattern would swallow this one
    const bystander = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'MyXBooks/a.m4b',
      uuid: '55555555-5555-4555-8555-00000000000b',
    });

    await service.putObject(
      user as any,
      makeUploadParams({ relativePath: 'Moved/My_Books', uuid, type: LibraryItemType.FOLDER }),
    );

    const bystanderRow = await trx('library_items')
      .where({ id_library_item: bystander.id_library_item })
      .first();
    expect(bystanderRow.key).toBe('MyXBooks/a.m4b');

    const movedChild = await trx('library_items')
      .where({ user_id: user.id_user, active: true, key: 'Moved/My_Books/a.m4b' })
      .first();
    expect(movedChild).toBeDefined();
  });

  it('inserts normally when the uuid only exists on an inactive row', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '66666666-6666-4666-8666-666666666666';
    const inactive = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Old.m4b',
      uuid,
      active: false,
    });

    const result = await service.putObject(
      user as any,
      makeUploadParams({ relativePath: 'New.m4b', uuid }),
    );

    expect(result.relativePath).toBe('New.m4b');

    const inactiveRow = await trx('library_items')
      .where({ id_library_item: inactive.id_library_item })
      .first();
    expect(inactiveRow.active).toBe(false);
    expect(inactiveRow.key).toBe('Old.m4b');

    const newRow = await trx('library_items')
      .where({ user_id: user.id_user, active: true, key: 'New.m4b' })
      .first();
    expect(newRow).toBeDefined();
    expect(newRow.uuid).toBe(uuid);
  });

  it('rejects with a 409 when the uuid belongs to an item of a different type', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const uuid = '77777777-7777-4777-8777-777777777777';
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      type: 2,
      uuid,
    });

    await expect(
      service.putObject(
        user as any,
        makeUploadParams({ relativePath: 'Series', uuid, type: LibraryItemType.FOLDER }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
