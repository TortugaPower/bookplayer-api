import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryDB } from '../../services/db/LibraryDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * Direct tests for the shared subtree key-rewrite primitive. The public
 * wrappers (moveFiles/renameFiles/moveFilesUp/moveFolderChildren/
 * moveItemToKey) are covered through their service flows; this file pins the
 * primitive's own contract: match-set correctness (boundary + escaping), both
 * collision modes, and the returned old_key mapping.
 */
describe('LibraryDB.rewriteKeyPrefix', () => {
  let db: LibraryDB;

  const rewrite = (
    user_id: number,
    oldPrefix: string,
    newPrefix: string,
    opts: { includeSelf: boolean; collisionWinner: 'mover' | 'occupant' },
  ) =>
    (db as any).rewriteKeyPrefix(
      user_id,
      oldPrefix,
      newPrefix,
      opts,
      getTestTransaction(),
    );

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('rewrites self and children for a multi-segment prefix and reports old keys', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'A/Foo',
      type: 0,
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'A/Foo/x.m4b',
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'A/Foo/Sub/y.m4b',
    });

    const moved = await rewrite(user.id_user, 'A/Foo', 'B/Bar', {
      includeSelf: true,
      collisionWinner: 'mover',
    });

    const byOldKey = new Map(moved.map((m: any) => [m.old_key, m.key]));
    expect(byOldKey.get('A/Foo')).toBe('B/Bar');
    expect(byOldKey.get('A/Foo/x.m4b')).toBe('B/Bar/x.m4b');
    expect(byOldKey.get('A/Foo/Sub/y.m4b')).toBe('B/Bar/Sub/y.m4b');
  });

  it('never captures same-prefix siblings, in either collision mode', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    for (const winner of ['mover', 'occupant'] as const) {
      const folder = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: `Series-${winner}`,
        type: 0,
      });
      const sibling = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: `Series-${winner} 2.m4b`,
      });

      await rewrite(user.id_user, `Series-${winner}`, `Moved-${winner}`, {
        includeSelf: true,
        collisionWinner: winner,
      });

      const folderAfter = await trx('library_items')
        .where({ id_library_item: folder.id_library_item })
        .first();
      const siblingAfter = await trx('library_items')
        .where({ id_library_item: sibling.id_library_item })
        .first();
      expect(folderAfter.key).toBe(`Moved-${winner}`);
      expect(siblingAfter.key).toBe(`Series-${winner} 2.m4b`);
      expect(siblingAfter.active).toBe(true);
    }
  });

  it('escapes LIKE wildcards in the prefix (underscore and percent)', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'My_100%',
      type: 0,
    });
    const child = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'My_100%/a.m4b',
    });
    const underscoreBystander = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'MyX100%/a.m4b',
    });
    const percentBystander = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'My_100 anything/a.m4b',
    });

    await rewrite(user.id_user, 'My_100%', 'Renamed', {
      includeSelf: true,
      collisionWinner: 'mover',
    });

    const childAfter = await trx('library_items')
      .where({ id_library_item: child.id_library_item })
      .first();
    const underscoreAfter = await trx('library_items')
      .where({ id_library_item: underscoreBystander.id_library_item })
      .first();
    const percentAfter = await trx('library_items')
      .where({ id_library_item: percentBystander.id_library_item })
      .first();
    expect(childAfter.key).toBe('Renamed/a.m4b');
    expect(underscoreAfter.key).toBe('MyX100%/a.m4b');
    expect(percentAfter.key).toBe('My_100 anything/a.m4b');
  });

  it('mover wins: occupant at the destination key is deactivated with uuid nulled', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const mover = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Foo/book.m4b',
    });
    const occupant = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Bar/book.m4b',
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Foo',
      type: 0,
    });

    await rewrite(user.id_user, 'Foo', 'Bar', {
      includeSelf: false,
      collisionWinner: 'mover',
    });

    const moverAfter = await trx('library_items')
      .where({ id_library_item: mover.id_library_item })
      .first();
    const occupantAfter = await trx('library_items')
      .where({ id_library_item: occupant.id_library_item })
      .first();
    expect(moverAfter.key).toBe('Bar/book.m4b');
    expect(moverAfter.active).toBe(true);
    expect(occupantAfter.active).toBe(false);
    expect(occupantAfter.uuid).toBeNull();
  });

  it('occupant wins: colliding mover is deactivated, occupant untouched', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const staleMover = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Foo/book.m4b',
    });
    const occupantUuid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const occupant = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Bar/book.m4b',
      uuid: occupantUuid,
    });

    const moved = await rewrite(user.id_user, 'Foo', 'Bar', {
      includeSelf: false,
      collisionWinner: 'occupant',
    });

    const staleAfter = await trx('library_items')
      .where({ id_library_item: staleMover.id_library_item })
      .first();
    const occupantAfter = await trx('library_items')
      .where({ id_library_item: occupant.id_library_item })
      .first();
    expect(staleAfter.active).toBe(false);
    expect(staleAfter.uuid).toBeNull();
    expect(occupantAfter.active).toBe(true);
    expect(occupantAfter.uuid).toBe(occupantUuid);
    expect(occupantAfter.key).toBe('Bar/book.m4b');
    // The deactivated mover is not part of the rewritten set
    expect(moved.map((m: any) => m.id_library_item)).not.toContain(
      staleMover.id_library_item,
    );
  });

  it('promotes children to the root with an empty newPrefix and no leading slash', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const child = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Foo/Sub/deep.m4b',
    });

    const moved = await rewrite(user.id_user, 'Foo', '', {
      includeSelf: false,
      collisionWinner: 'mover',
    });

    const childAfter = await trx('library_items')
      .where({ id_library_item: child.id_library_item })
      .first();
    expect(childAfter.key).toBe('Sub/deep.m4b');
    expect(moved[0].old_key).toBe('Foo/Sub/deep.m4b');
  });

  it('rejects includeSelf with an empty newPrefix', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await expect(
      rewrite(user.id_user, 'Foo', '', {
        includeSelf: true,
        collisionWinner: 'mover',
      }),
    ).rejects.toThrow('non-empty newPrefix');
  });
});
