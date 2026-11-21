import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import JWT from 'jsonwebtoken';
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

  it('does not 500 when app_version is missing from the request (regression: semver gte on undefined)', async () => {
    // gte(undefined, minVersion) used to throw "Invalid version" before any
    // onboarding logic ran. first_seen = now keeps us in the <7-day early return.
    const res = makeRes();
    await expect(
      controller.secondOnboarding(
        {
          body: {
            rc_id: 'rc_123',
            region: 'USA',
            first_seen: Math.floor(Date.now() / 1000),
          },
        } as any,
        res,
      ),
    ).resolves.toBeDefined();

    expect(res.json).toHaveBeenCalledWith({});
  });
});

describe('UserController.initLogin', () => {
  let userService: any;
  let controller: UserController;

  beforeEach(() => {
    userService = {
      verifyToken: jest.fn(),
      getAuthMethodByExternalId: jest.fn(),
      getUser: jest.fn(),
      addNewUser: jest.fn(),
      addAuthMethod: jest.fn(),
      addNewDevice: jest.fn(),
      tokenUser: jest.fn<() => Promise<string>>().mockResolvedValue('jwt'),
    };
    controller = new UserController(userService, {} as any);
  });

  const appleLogin = () =>
    controller.initLogin({ body: { token_id: 'apple-token' }, headers: {} } as any, makeRes());

  it("links Apple to an account whose email differs in case, and the token carries the account's email", async () => {
    // The account was created by a passkey sign-up typed lowercase; Apple keeps the casing
    userService.verifyToken.mockResolvedValue({ email: 'Jane.Doe@Example.com', sub: 'apple-sub' });
    userService.getAuthMethodByExternalId.mockResolvedValue(null);
    userService.getUser.mockResolvedValue({
      id_user: 7,
      email: 'jane.doe@example.com',
      external_id: 'uuid-7',
    });

    await appleLogin();

    expect(userService.addNewUser).not.toHaveBeenCalled();
    expect(userService.addAuthMethod).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, auth_type: 'apple', is_primary: false }),
    );
    // An email-prefixed account's files live under its own spelling
    expect(userService.tokenUser).toHaveBeenCalledWith(
      expect.objectContaining({ id_user: 7, email: 'jane.doe@example.com' }),
    );
  });

  it("keeps the account's email in the token on later sign-ins with the linked credential", async () => {
    userService.verifyToken.mockResolvedValue({ email: 'Jane.Doe@Example.com', sub: 'apple-sub' });
    userService.getAuthMethodByExternalId.mockResolvedValue({
      user_id: 7,
      id_auth_method: 1,
      email: 'jane.doe@example.com',
    });
    userService.getUser.mockResolvedValue({
      id_user: 7,
      email: 'jane.doe@example.com',
      external_id: 'uuid-7',
      session: 'apple-sub',
    });

    await appleLogin();

    expect(userService.tokenUser).toHaveBeenCalledWith(
      expect.objectContaining({ id_user: 7, email: 'jane.doe@example.com' }),
    );
  });

  it("keeps the provider's email in the token when it changed altogether", async () => {
    userService.verifyToken.mockResolvedValue({ email: 'new@example.com', sub: 'apple-sub' });
    userService.getAuthMethodByExternalId.mockResolvedValue({
      user_id: 7,
      id_auth_method: 1,
      email: 'old@example.com',
    });
    userService.getUser.mockResolvedValue({
      id_user: 7,
      email: 'old@example.com',
      external_id: 'uuid-7',
      session: 'apple-sub',
    });

    await appleLogin();

    expect(userService.tokenUser).toHaveBeenCalledWith(
      expect.objectContaining({ id_user: 7, email: 'new@example.com' }),
    );
  });

  describe('choosing the verifier', () => {
    // Unverified-looking tokens: only their issuer is read to choose a verifier.
    const idToken = (iss: string) => JWT.sign({ iss, sub: 'sub-1' }, 'not-a-real-key');
    const login = (token_id: string, platform?: string) =>
      controller.initLogin(
        { body: { token_id }, headers: platform ? { 'x-platform': platform } : {} } as any,
        makeRes(),
      );

    beforeEach(() => {
      userService.verifyGoogleToken = jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ success: true, user: { userId: 'google-sub', email: 'a@b.com' } });
      userService.verifyToken.mockResolvedValue({ email: 'a@b.com', sub: 'apple-sub' });
      userService.getAuthMethodByExternalId.mockResolvedValue(null);
      userService.getUser.mockResolvedValue(null);
      userService.addNewUser.mockResolvedValue({ id_user: 9, email: 'a@b.com', external_id: 'uuid-9' });
    });

    it('verifies a Google token from the web with Google (it used to go to Apple)', async () => {
      await login(idToken('https://accounts.google.com'), 'web');
      expect(userService.verifyGoogleToken).toHaveBeenCalled();
      expect(userService.verifyToken).not.toHaveBeenCalled();
      expect(userService.addAuthMethod).toHaveBeenCalledWith(
        expect.objectContaining({ auth_type: 'google', external_id: 'google-sub' }),
      );
    });

    it("takes Google's issuer without the scheme too", async () => {
      await login(idToken('accounts.google.com'), 'web');
      expect(userService.verifyGoogleToken).toHaveBeenCalled();
    });

    it('keeps Android on Google, whatever the token looks like', async () => {
      await login('opaque-token', 'android');
      expect(userService.verifyGoogleToken).toHaveBeenCalledWith('opaque-token');
      expect(userService.verifyToken).not.toHaveBeenCalled();
    });

    it('keeps an Apple token from the web on Apple', async () => {
      await login(idToken('https://appleid.apple.com'), 'web');
      expect(userService.verifyToken).toHaveBeenCalled();
      expect(userService.verifyGoogleToken).not.toHaveBeenCalled();
    });

    it("refuses a token that claims Google but doesn't verify", async () => {
      userService.verifyGoogleToken.mockResolvedValue({ success: false, error: 'bad signature' });
      const res = makeRes();
      await controller.initLogin(
        { body: { token_id: idToken('https://accounts.google.com') }, headers: { 'x-platform': 'web' } } as any,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid google id' });
      expect(userService.tokenUser).not.toHaveBeenCalled();
    });
  });
});
