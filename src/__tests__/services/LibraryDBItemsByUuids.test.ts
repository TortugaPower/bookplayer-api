import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryDB } from '../../services/db/LibraryDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
} from '../setup';

// The uuids become one Postgres array literal cast to uuid[]: a single string that
// isn't a uuid would fail the cast, and with it the whole library's status.
describe('LibraryDB.getItemsByUuids', () => {
  let db: LibraryDB;

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('skips strings that are not uuids instead of failing the query', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx, { email: 'items-by-uuids@example.com' });
    const book = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b' });

    const rows = await db.getItemsByUuids(user.id_user, ['Optional("x")', '', 'a,b}', book.uuid]);

    expect(rows?.map((row) => row.uuid)).toEqual([book.uuid]);
  });

  it('answers an empty list, not a failure, when nothing is a uuid', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx, { email: 'items-by-uuids-none@example.com' });

    await expect(db.getItemsByUuids(user.id_user, ['x', ''])).resolves.toEqual([]);
  });
});
