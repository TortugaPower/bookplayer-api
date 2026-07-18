import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserController } from '../../controllers/UserController';
import { UserEventEnum } from '../../types/user';

const DAY = 24 * 60 * 60 * 1000;

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('UserController.secondOnboarding', () => {
  let userService: any;
  let subscriptionService: any;
  let controller: UserController;

  beforeEach(() => {
    userService = {
      getLastUserEvent: jest.fn(),
      getUserEventCount: jest.fn(),
      getSecondOnboardings: jest.fn(),
    };
    subscriptionService = {
      hasInAppPurchase: jest.fn(),
    };
    controller = new UserController(userService, subscriptionService);
  });

  /// USA user, first_seen ~200 days ago, so we land in the post-skip
  /// (support_paywall) branch of handleDefaultOnboarding.
  const baseBody = () => ({
    rc_id: 'rc_123',
    region: 'USA',
    app_version: '5.5.1',
    first_seen: Math.floor((Date.now() - 200 * DAY) / 1000),
    onboarding_name: 'first_seen',
  });

  it('does not 500 when the user skipped but has no START event (regression: BOOKPLAYER-TSZ)', async () => {
    // Reproduces the production crash: a SKIP exists but its START was never
    // recorded (dropped client event), so getLastUserEvent(START) is null.
    const oldSkip = { created_at: new Date(Date.now() - 200 * DAY) };
    userService.getLastUserEvent.mockImplementation(async ({ event_name }: any) =>
      event_name === UserEventEnum.SECOND_ONBOARDING_SKIP ? oldSkip : null,
    );
    userService.getUserEventCount.mockResolvedValue(0);
    userService.getSecondOnboardings.mockResolvedValue([{ title: 'support' }]);
    subscriptionService.hasInAppPurchase.mockResolvedValue(false);

    const res = makeRes();

    // Before the null-guard this threw and surfaced as a 500.
    await expect(
      controller.secondOnboarding({ body: baseBody() } as any, res),
    ).resolves.toBeDefined();

    expect(userService.getSecondOnboardings).toHaveBeenCalledWith({
      onboarding_name: 'support_paywall',
    });
    expect(res.json).toHaveBeenCalledWith([{ title: 'support' }]);
  });

  it('still interrupts (returns {}) when a START was shown within the last 2 days', async () => {
    // Guards that adding `lastEvent != null` did not weaken the original
    // "shown too recently" short-circuit when a START does exist.
    const oldSkip = { created_at: new Date(Date.now() - 200 * DAY) };
    const recentStart = { created_at: new Date() };
    userService.getLastUserEvent.mockImplementation(async ({ event_name }: any) =>
      event_name === UserEventEnum.SECOND_ONBOARDING_SKIP ? oldSkip : recentStart,
    );
    subscriptionService.hasInAppPurchase.mockResolvedValue(false);

    const res = makeRes();
    await controller.secondOnboarding({ body: baseBody() } as any, res);

    expect(res.json).toHaveBeenCalledWith({});
    expect(userService.getSecondOnboardings).not.toHaveBeenCalled();
  });
});
