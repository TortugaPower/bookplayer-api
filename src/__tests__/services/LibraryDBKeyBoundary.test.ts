import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryDB } from '../../services/db/LibraryDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

/**
 * A key is a literal, never a pattern. The destructive queries used to run
 * `key like '<folder>%'`: no '/' boundary and no wildcard escaping, so deleting
 * "Dune" also took "Dune-1/…" (the app's own de-duplication suffix) and the
 * root file "Dune.m4b", and then removed their S3 objects. These pin the
 * bounded, escaped behaviour on every key-pattern query in LibraryDB.
 */
describe('LibraryDB — key patterns match the row and its true children only', () => {
  let db: LibraryDB;

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  // Dune/            Dune-1/            Dune.m4b        A_B/            AxB/
  //   Book 1.m4b       Book 2.m4b                         one.m4b         two.m4b
  //                                                       Sub/deep.m4b
  async function seed(userId: number) {
    const trx = getTestTransaction();
    const dune = await createTestLibraryItem(trx, { user_id: userId, key: 'Dune', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Dune/Book 1.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Dune-1', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Dune-1/Book 2.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'Dune.m4b' });
    const underscore = await createTestLibraryItem(trx, { user_id: userId, key: 'A_B', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'A_B/one.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'A_B/Sub', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'A_B/Sub/deep.m4b' });
    await createTestLibraryItem(trx, { user_id: userId, key: 'AxB', type: 0 });
    await createTestLibraryItem(trx, { user_id: userId, key: 'AxB/two.m4b' });
    return { dune, underscore };
  }

  async function activeKeys(userId: number): Promise<string[]> {
    const rows = await getTestTransaction()('library_items')
      .where({ user_id: userId, active: true })
      .select('key');
    return rows.map((r: { key: string }) => r.key).sort();
  }

  it('deleteLibrary by path takes the folder and its descendants, not the "-1" sibling or the same-named file', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const deleted = await db.deleteLibrary({ user_id: user.id_user, path: 'Dune' });

    expect(deleted.map((r) => r.key).sort()).toEqual(['Dune', 'Dune/Book 1.m4b']);
    expect(await activeKeys(user.id_user)).toEqual(
      expect.arrayContaining(['Dune-1', 'Dune-1/Book 2.m4b', 'Dune.m4b']),
    );
  });

  it('deleteLibrary with exactly=true takes the row alone', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const deleted = await db.deleteLibrary({ user_id: user.id_user, path: 'Dune', exactly: true });

    expect(deleted.map((r) => r.key)).toEqual(['Dune']);
    expect(await activeKeys(user.id_user)).toContain('Dune/Book 1.m4b');
  });

  it('deleteLibrary on a book key takes only that book', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const deleted = await db.deleteLibrary({ user_id: user.id_user, path: 'Dune.m4b' });

    expect(deleted.map((r) => r.key)).toEqual(['Dune.m4b']);
    expect(await activeKeys(user.id_user)).toEqual(expect.arrayContaining(['Dune', 'Dune/Book 1.m4b']));
  });

  it('deleteLibraryByUuid treats LIKE wildcards in the key as literal', async () => {
    const user = await createTestUser(getTestTransaction());
    const { underscore } = await seed(user.id_user);

    const deleted = await db.deleteLibraryByUuid({ user_id: user.id_user, uuid: underscore.uuid });

    expect(deleted.map((r) => r.key).sort()).toEqual(['A_B', 'A_B/Sub', 'A_B/Sub/deep.m4b', 'A_B/one.m4b']);
    expect(await activeKeys(user.id_user)).toEqual(expect.arrayContaining(['AxB', 'AxB/two.m4b']));
  });

  it('getNestedObjects lists the descendants of the folder alone', async () => {
    const user = await createTestUser(getTestTransaction());
    await seed(user.id_user);

    const nested = await db.getNestedObjects(user.id_user, 'A_B');

    expect(nested.map((r) => r.key).sort()).toEqual(['A_B/Sub', 'A_B/Sub/deep.m4b', 'A_B/one.m4b']);
  });

  it('shiftOrderRanks moves the ranks under the folder alone', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    await seed(user.id_user);

    await db.shiftOrderRanks(
      { user_id: user.id_user, path: 'A_B/', pathDepth: 2, orderRange: [0, 10], direction: 'increment' },
      trx,
    );

    const ranks = await trx('library_items')
      .where({ user_id: user.id_user })
      .whereIn('key', ['A_B/one.m4b', 'A_B/Sub', 'AxB/two.m4b'])
      .select('key', 'order_rank');
    const byKey = Object.fromEntries(ranks.map((r: { key: string; order_rank: number }) => [r.key, r.order_rank]));
    expect(byKey).toEqual({ 'A_B/one.m4b': 1, 'A_B/Sub': 1, 'AxB/two.m4b': 0 });
  });
});
