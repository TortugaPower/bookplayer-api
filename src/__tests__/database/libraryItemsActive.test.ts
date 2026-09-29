import { describe, it, expect } from '@jest/globals';
import { getTestTransaction, createTestUser } from '../setup';

// Migration 20260929120000: every read filters on `active = true`, so a NULL
// `active` was an invisible third state. It's now NOT NULL, defaulting to true.
describe('library_items.active', () => {
  const baseRow = (user_id: number, key: string) => ({
    user_id,
    key,
    title: key,
    original_filename: key,
    speed: 1,
    actual_time: '0',
    details: key,
    duration: '0',
    percent_completed: 0,
    order_rank: 0,
    type: 2,
    is_finish: false,
    synced: false,
  });

  it('defaults to true', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx, { email: 'active-default@example.com' });

    const [row] = await trx('library_items').insert(baseRow(user.id_user, 'Default.m4b')).returning('active');

    expect(row.active).toBe(true);
  });

  it('rejects NULL', async () => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx, { email: 'active-null@example.com' });

    // A savepoint, so the failed insert doesn't abort the test's transaction
    await expect(
      trx.transaction((savepoint) =>
        savepoint('library_items').insert({ ...baseRow(user.id_user, 'Null.m4b'), active: null }),
      ),
    ).rejects.toThrow(/null value in column "active"/);
  });
});
