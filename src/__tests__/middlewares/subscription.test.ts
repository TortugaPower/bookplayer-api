import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockIsActive =
  jest.fn<(externalId: string) => Promise<boolean>>();
const mockGetExternalIdByUserId =
  jest.fn<(userId: number) => Promise<string | null>>();

// Replace the SubscriptionService class with one whose isActive we control.
// Hoisted by jest before the module-under-test is imported, so the singleton
// in subscription.ts ends up holding our mock.
jest.mock('../../services/SubscriptionService', () => ({
  SubscriptionService: jest.fn().mockImplementation(() => ({
    isActive: mockIsActive,
  })),
}));

jest.mock('../../services/db/UserDB', () => ({
  UserDB: jest.fn().mockImplementation(() => ({
    getExternalIdByUserId: mockGetExternalIdByUserId,
  })),
}));

// eslint-disable-next-line import/first
import { checkSubscription } from '../../api/middlewares/subscription';

describe('checkSubscription middleware', () => {
  let req: any;
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    mockIsActive.mockReset();
    mockGetExternalIdByUserId.mockReset();
    req = { user: { id_user: 1, external_id: 'ext-1' } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('returns 400 when req.user is missing', async () => {
    req.user = undefined;
    await checkSubscription(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'the user is invalid' });
    expect(next).not.toHaveBeenCalled();
    expect(mockIsActive).not.toHaveBeenCalled();
  });

  it('calls next() when isActive returns true', async () => {
    mockIsActive.mockResolvedValue(true);
    await checkSubscription(req, res, next);
    expect(mockIsActive).toHaveBeenCalledWith('ext-1');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 "not subscribed" when isActive returns false', async () => {
    mockIsActive.mockResolvedValue(false);
    await checkSubscription(req, res, next);
    expect(mockIsActive).toHaveBeenCalledWith('ext-1');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'You are not subscribed' });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards thrown errors to next()', async () => {
    const error = new Error('boom');
    mockIsActive.mockRejectedValue(error);
    await checkSubscription(req, res, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('falls back to DB lookup when JWT lacks external_id (legacy Apple login)', async () => {
    req.user = { id_user: 42 };  // no external_id — pre-fix Apple JWT shape
    mockGetExternalIdByUserId.mockResolvedValue('ext-from-db');
    mockIsActive.mockResolvedValue(true);

    await checkSubscription(req, res, next);

    expect(mockGetExternalIdByUserId).toHaveBeenCalledWith(42);
    expect(mockIsActive).toHaveBeenCalledWith('ext-from-db');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
