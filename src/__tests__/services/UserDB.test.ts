import { describe, it, expect, beforeEach } from '@jest/globals';
import { UserDB } from '../../services/db/UserDB';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
} from '../setup';

describe('UserDB.getActiveUserById', () => {
  let db: UserDB;

  beforeEach(() => {
    db = new UserDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('returns only id_user, email and external_id for an active user', async () => {
    const user = await createTestUser(getTestTransaction(), {
      email: 'billing-reader@example.com',
    });

    const row = await db.getActiveUserById(user.id_user);

    expect(row).toEqual({
      id_user: user.id_user,
      email: 'billing-reader@example.com',
      external_id: user.external_id,
    });
  });

  it('returns undefined for an inactive or unknown user', async () => {
    const inactive = await createTestUser(getTestTransaction(), {
      active: false,
    });

    expect(await db.getActiveUserById(inactive.id_user)).toBeUndefined();
    expect(await db.getActiveUserById(2_000_000_000)).toBeUndefined();
  });

  it('returns null and logs when the read fails', async () => {
    (db as any).db = () => {
      throw new Error('connection terminated');
    };

    expect(await db.getActiveUserById(1)).toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'UserDB.getActiveUserById',
        message: 'connection terminated',
      }),
    );
  });
});
