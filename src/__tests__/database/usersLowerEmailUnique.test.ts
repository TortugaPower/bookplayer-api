import { describe, it, expect } from '@jest/globals';
import { getTestTransaction, createTestUser } from '../setup';

// Migration 20261013120000: account lookups ignore the email's case, so only
// one active account may hold an email, whatever its case.
describe('users_lower_email_active_unique', () => {
  it('rejects a second active account whose email differs only in case', async () => {
    const trx = getTestTransaction();
    await createTestUser(trx, { email: 'Jane.Doe@Example.com' });

    // A savepoint, so the failed insert doesn't abort the test's transaction
    await expect(
      trx.transaction((savepoint) =>
        createTestUser(savepoint, { email: 'jane.doe@example.com' }),
      ),
    ).rejects.toThrow(/users_lower_email_active_unique/);
  });

  it('allows it once the other account is inactive', async () => {
    const trx = getTestTransaction();
    await createTestUser(trx, { email: 'Gone.Doe@Example.com', active: false });

    const user = await createTestUser(trx, { email: 'gone.doe@example.com' });

    expect(user.email).toBe('gone.doe@example.com');
  });
});
