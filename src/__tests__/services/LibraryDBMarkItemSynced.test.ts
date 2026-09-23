import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryDB } from '../../services/db/LibraryDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestLibraryItem,
  createTestExternalResource,
} from '../setup';

// `complete` is the only confirmation a multipart upload gets, and it now also
// carries books streamed in from a media server — so it must leave their
// external resources exactly as the single-PUT pipe's confirmation did.
describe('LibraryDB.markItemSynced', () => {
  let db: LibraryDB;

  beforeEach(() => {
    db = new LibraryDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
  });

  const setup = async (active = true) => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, {
      user_id: user.id_user,
      key: 'Book.m4b',
      synced: false,
      active,
    });
    return { trx, item };
  };

  it('marks a plain upload synced, with no external rows to touch', async () => {
    const { trx, item } = await setup();

    await expect(db.markItemSynced(item.id_library_item, trx)).resolves.toBe(true);

    const row = await trx('library_items').where({ id_library_item: item.id_library_item }).first();
    expect(row.synced).toBe(true);
  });

  it('marks a media-server book downloaded too, leaving removed links alone', async () => {
    const { trx, item } = await setup();
    const live = await createTestExternalResource(trx, {
      library_item_id: item.id_library_item,
      provider_name: 'jellyfin',
    });
    const removed = await createTestExternalResource(trx, {
      library_item_id: item.id_library_item,
      provider_name: 'audiobookshelf',
    });
    await trx('external_resources').update({ active: false }).where({ id: removed.id });

    await db.markItemSynced(item.id_library_item, trx);

    const status = async (id: number) =>
      (await trx('external_resources').where({ id }).first()).sync_status;
    expect(await status(live.id)).toBe('downloaded');
    expect(await status(removed.id)).toBe('pending');
  });

  it('reports false, and touches nothing, once the row is no longer active', async () => {
    const { trx, item } = await setup(false);
    const resource = await createTestExternalResource(trx, { library_item_id: item.id_library_item });

    await expect(db.markItemSynced(item.id_library_item, trx)).resolves.toBe(false);

    const row = await trx('library_items').where({ id_library_item: item.id_library_item }).first();
    expect(row.synced).toBe(false);
    expect((await trx('external_resources').where({ id: resource.id }).first()).sync_status).toBe('pending');
  });
});
