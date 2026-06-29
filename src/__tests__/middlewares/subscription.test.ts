import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockIsActive =
  jest.fn<(externalId: string) => Promise<SubscriptionState>>();
const mockFetchLiveEntitlements =
  jest.fn<(externalId: string) => Promise<SubscriptionState | null>>();
const mockGetExternalIdByUserId =
  jest.fn<(userId: number) => Promise<string | null>>();

// Replace the SubscriptionService class with one whose methods we control.
// Hoisted by jest before the module-under-test is imported, so the singleton
// in subscription.ts ends up holding our mock.
jest.mock('../../services/SubscriptionService', () => ({
  SubscriptionService: jest.fn().mockImplementation(() => ({
    isActive: mockIsActive,
    fetchLiveEntitlements: mockFetchLiveEntitlements,
  })),
}));

jest.mock('../../services/db/UserDB', () => ({
  UserDB: jest.fn().mockImplementation(() => ({
    getExternalIdByUserId: mockGetExternalIdByUserId,
  })),
}));

// eslint-disable-next-line import/first
import { checkSubscription, requireSubscription } from '../../api/middlewares/subscription';
import { SubscriptionState, SubscriptionTierEnum } from '../../types/user';

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
    mockIsActive.mockResolvedValue({ active: true, verified: 'local', subscriptions: [] });
    await checkSubscription(req, res, next);
    expect(mockIsActive).toHaveBeenCalledWith('ext-1');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 "not subscribed" when isActive returns false', async () => {
    mockIsActive.mockResolvedValue({ active: false, verified: 'local', subscriptions: [] });
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
    mockIsActive.mockResolvedValue({ active: true, verified: 'local', subscriptions: [] });

    await checkSubscription(req, res, next);

    expect(mockGetExternalIdByUserId).toHaveBeenCalledWith(42);
    expect(mockIsActive).toHaveBeenCalledWith('ext-from-db');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireSubscription middleware', () => {
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    mockFetchLiveEntitlements.mockReset();
    mockGetExternalIdByUserId.mockReset();
    // Default: live RC check finds no upgrade.
    mockFetchLiveEntitlements.mockResolvedValue(null);
    mockGetExternalIdByUserId.mockResolvedValue('ext-1');
  });

  it('calls next() when the user holds an allowed tier (no RC call)', async () => {
    const req: any = { user: { id_user: 1, external_id: 'ext-1', subscriptions: [SubscriptionTierEnum.PRO] } };
    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockFetchLiveEntitlements).not.toHaveBeenCalled();
  });

  it('matches a tier anywhere in the subscriptions array (not just index 0)', async () => {
    const req: any = {
      user: { id_user: 1, external_id: 'ext-1', subscriptions: [SubscriptionTierEnum.LITE, SubscriptionTierEnum.PRO] },
    };
    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockFetchLiveEntitlements).not.toHaveBeenCalled();
  });

  it('falls back to RC and allows the action when RC confirms the upgraded tier (lite → pro)', async () => {
    const req: any = { user: { id_user: 1, external_id: 'ext-1', subscriptions: [SubscriptionTierEnum.LITE] } };
    mockFetchLiveEntitlements.mockResolvedValue({
      active: true,
      verified: 'rc',
      subscriptions: ['pro'],
    });

    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);

    expect(mockFetchLiveEntitlements).toHaveBeenCalledWith('ext-1');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // req.user.subscriptions refreshed for downstream handlers
    expect(req.user.subscriptions).toEqual(['pro']);
  });

  it('returns 403 when RC also lacks the required tier (no real upgrade)', async () => {
    const req: any = { user: { id_user: 1, external_id: 'ext-1', subscriptions: [SubscriptionTierEnum.LITE] } };
    mockFetchLiveEntitlements.mockResolvedValue({
      active: true,
      verified: 'rc',
      subscriptions: ['lite'],
    });

    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);

    expect(mockFetchLiveEntitlements).toHaveBeenCalledWith('ext-1');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Requires one of: pro' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when RC is unreachable (fetchLiveEntitlements returns null)', async () => {
    const req: any = { user: { id_user: 1, external_id: 'ext-1', subscriptions: [SubscriptionTierEnum.FREE] } };
    mockFetchLiveEntitlements.mockResolvedValue(null);

    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves externalId via DB lookup when the JWT lacks external_id, then checks RC', async () => {
    const req: any = { user: { id_user: 42, subscriptions: [SubscriptionTierEnum.LITE] } };
    mockGetExternalIdByUserId.mockResolvedValue('ext-from-db');
    mockFetchLiveEntitlements.mockResolvedValue({ active: true, verified: 'rc', subscriptions: ['pro'] });

    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);

    expect(mockGetExternalIdByUserId).toHaveBeenCalledWith(42);
    expect(mockFetchLiveEntitlements).toHaveBeenCalledWith('ext-from-db');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 (does not throw) when subscriptions is undefined and RC finds nothing', async () => {
    const req: any = { user: { id_user: 1, external_id: 'ext-1' } };
    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with a message when req.user is missing', async () => {
    const req: any = {};
    await requireSubscription([SubscriptionTierEnum.PRO])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'User data missing.' });
    expect(next).not.toHaveBeenCalled();
    expect(mockFetchLiveEntitlements).not.toHaveBeenCalled();
  });
});
