import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryDB } from '../../services/db/LibraryDB';
import { LibraryService } from '../../services/LibraryService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

describe('LibraryDB — source-wins merge on bulk key updates', () => {
  let db: LibraryDB;

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('moveFiles', () => {
    it('deactivates an existing destination row that collides with a mover, leaving the mover at the destination key', async () => {
      // moveFiles(origin='Foo', destination='Bar') rewrites every active row
      // whose key matches `Foo%` so that its key starts with `Bar/`. The
      // mover's new key is `Bar/<origin-segment>/.../` (origin is nested
      // INSIDE destination). Pre-existing rows at that destination key would
      // trip the partial unique index; this test asserts they're deactivated.
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const mover = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Foo/book.m4b',
      });
      const collider = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Bar/Foo/book.m4b',
      });

      await db.moveFiles(user.id_user, 'Foo', 'Bar', trx);

      const moverAfter = await trx('library_items')
        .where({ id_library_item: mover.id_library_item })
        .first();
      const colliderAfter = await trx('library_items')
        .where({ id_library_item: collider.id_library_item })
        .first();

      expect(moverAfter.key).toBe('Bar/Foo/book.m4b');
      expect(moverAfter.active).toBe(true);
      expect(colliderAfter.active).toBe(false);
      expect(colliderAfter.uuid).toBeNull();
    });

    it('leaves non-colliding destination rows untouched', async () => {
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const mover = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Foo/book.m4b',
      });
      const sibling = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Bar/other.m4b',
      });

      await db.moveFiles(user.id_user, 'Foo', 'Bar', trx);

      const moverAfter = await trx('library_items')
        .where({ id_library_item: mover.id_library_item })
        .first();
      const siblingAfter = await trx('library_items')
        .where({ id_library_item: sibling.id_library_item })
        .first();

      expect(moverAfter.key).toBe('Bar/Foo/book.m4b');
      expect(siblingAfter.active).toBe(true);
      expect(siblingAfter.key).toBe('Bar/other.m4b');
    });
  });

  describe('renameFiles', () => {
    it('deactivates an existing destination row that collides with a renamed child', async () => {
      // renameFiles(origin='Foo', destination='Bar') REPLACES the origin prefix
      // with destination. `Foo/book.m4b` → `Bar/book.m4b`. A pre-existing
      // `Bar/book.m4b` collides and must be deactivated under source-wins.
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const mover = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Foo/book.m4b',
      });
      const collider = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Bar/book.m4b',
      });

      await db.renameFiles(user.id_user, 'Foo', 'Bar', trx);

      const moverAfter = await trx('library_items')
        .where({ id_library_item: mover.id_library_item })
        .first();
      const colliderAfter = await trx('library_items')
        .where({ id_library_item: collider.id_library_item })
        .first();

      expect(moverAfter.key).toBe('Bar/book.m4b');
      expect(moverAfter.active).toBe(true);
      expect(colliderAfter.active).toBe(false);
      expect(colliderAfter.uuid).toBeNull();
    });
  });

  describe('moveFilesUp', () => {
    it('deactivates a sibling at the parent level that collides with a promoted child', async () => {
      // moveFilesUp removes one path segment. `Foo/book.m4b` → `book.m4b`.
      // A pre-existing root-level `book.m4b` collides and must be deactivated.
      const trx = getTestTransaction();
      const user = await createTestUser(trx);

      const mover = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'Foo/book.m4b',
      });
      const collider = await createTestLibraryItem(trx, {
        user_id: user.id_user,
        key: 'book.m4b',
      });

      await db.moveFilesUp(user.id_user, 'Foo', trx);

      const moverAfter = await trx('library_items')
        .where({ id_library_item: mover.id_library_item })
        .first();
      const colliderAfter = await trx('library_items')
        .where({ id_library_item: collider.id_library_item })
        .first();

      expect(moverAfter.key).toBe('book.m4b');
      expect(moverAfter.active).toBe(true);
      expect(colliderAfter.active).toBe(false);
      expect(colliderAfter.uuid).toBeNull();
    });
  });
});

describe('LibraryService.moveLibraryObject — destination-folder insert guard', () => {
  let service: LibraryService;

  beforeEach(() => {
    service = new LibraryService();
    // Route the service's own this.db.transaction() through the test trx so
    // the service's nested commit/rollback only releases a savepoint and the
    // outer test transaction still rolls everything back in afterEach.
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('does not create an additional destination folder row when one already exists', async () => {
    // The original bug: when an existing duplicate set of destination folders
    // existed at the same key, the `length !== 1` guard treated >1 as "no
    // folder, create one" — adding a third row, then a fourth, etc. The fix
    // is `length === 0` so we only insert when truly absent.
    //
    // The pre-fix data shape (multiple active rows at the same key) is now
    // structurally impossible thanks to the partial unique index added in
    // 20260517055535_library_items_key_unique. So this test exercises the
    // remaining reachable scenario: exactly one folder already exists, and
    // the service must NOT add a second one.
    const trx = getTestTransaction();
    const user = await createTestUser(trx);

    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Foo',
      type: 0,
    });
    await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'book.m4b',
      type: 2,
    });

    await service.moveLibraryObject(
      { id_user: user.id_user, email: user.email } as any,
      { origin: 'book.m4b', destination: 'Foo' },
    );

    const destinationFolderCount = await trx('library_items')
      .where({ user_id: user.id_user, key: 'Foo', active: true })
      .count<{ count: string }[]>('* as count');

    expect(parseInt(destinationFolderCount[0].count)).toBe(1);

    const movedItem = await trx('library_items')
      .where({ user_id: user.id_user, key: 'Foo/book.m4b', active: true })
      .first();
    expect(movedItem).toBeDefined();
  });
});
