import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { UserServices } from '../../services/UserServices';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestAuthMethod,
} from '../setup';

describe('UserServices - Duplicate Prevention', () => {
  let service: UserServices;

  beforeEach(() => {
    service = new UserServices();
    (service as any)._logger = mockLoggerService;
    (service as any).db = getTestTransaction();
    (service as any)._userDB.db = getTestTransaction();
    (service as any)._userDB._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  describe('GetAuthMethodByExternalId', () => {
    it('should return auth method and user info when found', async () => {
      const trx = getTestTransaction();

      // Create user and auth method
      const user = await createTestUser(trx, { email: 'test@example.com' });
      await createTestAuthMethod(trx, {
        user_id: user.id_user,
        auth_type: 'apple',
        external_id: 'apple-sub-12345',
        is_primary: true,
      });

      const result = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: 'apple-sub-12345',
      });

      expect(result).not.toBeNull();
      expect(result!.user_id).toBe(user.id_user);
      expect(result!.email).toBe('test@example.com');
    });

    it('should return null when auth method not found', async () => {
      const result = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: 'nonexistent-id',
      });

      expect(result).toBeNull();
    });

    it('should not return inactive auth methods', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'test@example.com' });

      // Create inactive auth method
      await trx('auth_methods').insert({
        user_id: user.id_user,
        auth_type: 'apple',
        external_id: 'apple-sub-inactive',
        active: false,
      });

      const result = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: 'apple-sub-inactive',
      });

      expect(result).toBeNull();
    });

    it('should not return auth methods for inactive users', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, {
        email: 'deleted@example.com',
        active: false,
      });
      await createTestAuthMethod(trx, {
        user_id: user.id_user,
        auth_type: 'apple',
        external_id: 'apple-sub-deleted-user',
      });

      const result = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: 'apple-sub-deleted-user',
      });

      expect(result).toBeNull();
    });

    it('should differentiate between auth types', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'test@example.com' });
      await createTestAuthMethod(trx, {
        user_id: user.id_user,
        auth_type: 'passkey',
        external_id: 'credential-id-123',
      });

      // Should not find when looking for different auth type
      const result = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: 'credential-id-123',
      });

      expect(result).toBeNull();
    });
  });

  describe('AddAuthMethod', () => {
    it('should create auth method successfully', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'test@example.com' });

      const result = await service.addAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-sub-new',
          is_primary: true,
        },
        trx,
      );

      expect(result).not.toBeNull();
      expect(result!.id_auth_method).toBeGreaterThan(0);

      const authMethod = await trx('auth_methods')
        .where('id_auth_method', result!.id_auth_method)
        .first();
      expect(authMethod.user_id).toBe(user.id_user);
      expect(authMethod.auth_type).toBe('apple');
      expect(authMethod.external_id).toBe('apple-sub-new');
      expect(authMethod.is_primary).toBe(true);
    });

    it('should return null for duplicate auth method', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'test@example.com' });

      // Create first auth method
      await createTestAuthMethod(trx, {
        user_id: user.id_user,
        auth_type: 'apple',
        external_id: 'apple-sub-duplicate',
      });

      // Try to create duplicate
      const result = await service.addAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-sub-duplicate',
        },
        trx,
      );

      expect(result).toBeNull();
    });

    it('should allow same external_id with different auth_type', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'test@example.com' });

      await createTestAuthMethod(trx, {
        user_id: user.id_user,
        auth_type: 'apple',
        external_id: 'same-id',
      });

      // Different auth_type should be allowed
      const result = await service.addAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'same-id',
        },
        trx,
      );

      expect(result).not.toBeNull();
    });

    it('should set default values correctly', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'test@example.com' });

      const result = await service.addAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-sub-defaults',
        },
        trx,
      );

      const authMethod = await trx('auth_methods')
        .where('id_auth_method', result!.id_auth_method)
        .first();

      expect(authMethod.is_primary).toBe(false);
      expect(authMethod.active).toBe(true);
      expect(authMethod.metadata).toEqual({});
    });
  });

  describe('Integration: Duplicate Prevention Flow', () => {
    it('should find existing user by auth_method when Apple ID email changes', async () => {
      const trx = getTestTransaction();
      const appleId = 'apple-sub-email-change';

      // Step 1: Create original user with Apple ID
      const originalUser = await createTestUser(trx, {
        email: 'original@example.com',
      });
      await createTestAuthMethod(trx, {
        user_id: originalUser.id_user,
        auth_type: 'apple',
        external_id: appleId,
        is_primary: true,
      });

      // Step 2: Simulate user changing their Apple ID email
      // New email lookup fails (no user with new email)
      const userByNewEmail = await trx('users')
        .where('email', 'new-email@example.com')
        .first();
      expect(userByNewEmail).toBeUndefined();

      // Step 3: Look up by Apple ID in auth_methods - finds original user
      const existingAuth = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: appleId,
      });
      expect(existingAuth).not.toBeNull();
      expect(existingAuth!.user_id).toBe(originalUser.id_user);
      expect(existingAuth!.email).toBe('original@example.com');

      // Step 4: Use the stored email to fetch user (no email update needed)
      const user = await trx('users')
        .where('email', existingAuth!.email)
        .first();
      expect(user).not.toBeUndefined();
      expect(user.id_user).toBe(originalUser.id_user);
    });

    it('should create new user when Apple ID is truly new', async () => {
      const trx = getTestTransaction();
      const newAppleId = 'brand-new-apple-id';

      // Step 1: Verify no existing auth method
      const existingAuth = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: newAppleId,
      });
      expect(existingAuth).toBeNull();

      // Step 2: Create new user (simulating AddNewUser)
      const newUser = await createTestUser(trx, {
        email: 'newuser@example.com',
      });

      // Step 3: Add auth method for future duplicate prevention
      const authMethod = await service.addAuthMethod(
        {
          user_id: newUser.id_user,
          auth_type: 'apple',
          external_id: newAppleId,
          is_primary: true,
        },
        trx,
      );

      expect(authMethod).not.toBeNull();

      // Step 4: Future lookups should find this user
      const foundAuth = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: newAppleId,
      });
      expect(foundAuth).not.toBeNull();
      expect(foundAuth!.user_id).toBe(newUser.id_user);
    });

    it('should handle user with multiple auth methods', async () => {
      const trx = getTestTransaction();

      const user = await createTestUser(trx, { email: 'multi@example.com' });

      // Add Apple auth method
      await service.addAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-sub-multi',
          is_primary: true,
        },
        trx,
      );

      // Add Passkey auth method
      await service.addAuthMethod(
        {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-credential-multi',
          is_primary: false,
        },
        trx,
      );

      // Both should resolve to same user
      const byApple = await service.getAuthMethodByExternalId({
        auth_type: 'apple',
        external_id: 'apple-sub-multi',
      });
      const byPasskey = await service.getAuthMethodByExternalId({
        auth_type: 'passkey',
        external_id: 'passkey-credential-multi',
      });

      expect(byApple!.user_id).toBe(user.id_user);
      expect(byPasskey!.user_id).toBe(user.id_user);
    });
  });
});

describe('UserServices - verifyGoogleToken', () => {
  let service: UserServices;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let verifyIdToken: any; // jest mock; loosely typed to avoid @jest/globals 'never' arg inference
  const ORIGINAL_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

  const basePayload = {
    sub: 'google-sub-123',
    email: 'user@example.com',
    email_verified: true,
    name: 'Test User',
    picture: 'https://example.com/p.png',
  };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    service = new UserServices();
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
    verifyIdToken = jest.fn();
    // Override the real OAuth2Client with a mock (no network / no DB needed).
    (service as any).googleClient = { verifyIdToken };
  });

  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = ORIGINAL_CLIENT_ID;
  });

  const mockPayload = (payload: unknown) =>
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });

  it('returns success with the user for a valid, verified token', async () => {
    mockPayload(basePayload);

    const result = await service.verifyGoogleToken('valid-token');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: 'test-client-id.apps.googleusercontent.com',
    });
    expect(result).toEqual({
      success: true,
      user: {
        userId: 'google-sub-123',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'https://example.com/p.png',
      },
    });
  });

  it('fails when the token has no payload', async () => {
    mockPayload(undefined);

    const result = await service.verifyGoogleToken('payloadless-token');

    expect(result).toEqual({ success: false, error: 'Token payload is empty' });
  });

  it('fails when the email is not verified', async () => {
    mockPayload({ ...basePayload, email_verified: false });

    const result = await service.verifyGoogleToken('unverified-email-token');

    expect(result.success).toBe(false);
  });

  it('fails when the subject (sub) is missing', async () => {
    mockPayload({ ...basePayload, sub: undefined });

    const result = await service.verifyGoogleToken('no-sub-token');

    expect(result.success).toBe(false);
  });

  it('fails (and logs) without leaking the token when verification throws', async () => {
    verifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

    const result = await service.verifyGoogleToken('bad-token');

    expect(result).toEqual({ success: false, error: 'Invalid token signature' });
    expect(mockLoggerService.log).toHaveBeenCalled();
    const logged = JSON.stringify(mockLoggerService.log.mock.calls);
    expect(logged).not.toContain('bad-token');
  });
});
