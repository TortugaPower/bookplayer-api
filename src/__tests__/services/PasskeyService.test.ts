import { describe, it, expect, beforeEach } from '@jest/globals';
import moment from 'moment';
import { randomUUID, randomBytes } from 'crypto';
import { PasskeyService } from '../../services/PasskeyService';
import {
  getTestTransaction,
  mockLoggerService,
  createTestUser,
  createTestAuthMethod,
  createTestChallenge,
  createTestPasskeyCredential,
  createTestUserParam,
} from '../setup';

describe('PasskeyService', () => {
  let service: PasskeyService;

  beforeEach(() => {
    service = new PasskeyService();
    (service as any)._logger = mockLoggerService;
    (service as any).db = getTestTransaction();
    mockLoggerService.log.mockClear();
  });

  describe('Challenge Management', () => {
    describe('storeChallenge', () => {
      it('should store a registration challenge', async () => {
        const trx = getTestTransaction();
        const challenge = randomBytes(32);

        const id = await service.storeChallenge({
          challenge,
          email: 'test@example.com',
          challenge_type: 'registration',
        });

        expect(id).toBeGreaterThan(0);

        const stored = await trx('webauthn_challenges')
          .where('id_challenge', id)
          .first();

        expect(stored).toBeDefined();
        expect(stored.email).toBe('test@example.com');
        expect(stored.challenge_type).toBe('registration');
        expect(stored.challenge.equals(challenge)).toBe(true);
      });

      it('should store an authentication challenge with user_id', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });
        const challenge = randomBytes(32);

        const id = await service.storeChallenge({
          challenge,
          user_id: user.id_user,
          challenge_type: 'authentication',
        });

        const stored = await trx('webauthn_challenges')
          .where('id_challenge', id)
          .first();

        expect(stored.user_id).toBe(user.id_user);
        expect(stored.challenge_type).toBe('authentication');
      });

      it('should set expiration time based on TTL', async () => {
        const trx = getTestTransaction();
        const challenge = randomBytes(32);
        const beforeStore = moment();

        await service.storeChallenge({
          challenge,
          email: 'test@example.com',
          challenge_type: 'registration',
        });

        const stored = await trx('webauthn_challenges')
          .where('email', 'test@example.com')
          .first();

        const expiresAt = moment(stored.expires_at);
        const expectedMin = beforeStore.clone().add(300, 'seconds');
        const expectedMax = moment().add(300, 'seconds');

        expect(expiresAt.isSameOrAfter(expectedMin)).toBe(true);
        expect(expiresAt.isSameOrBefore(expectedMax)).toBe(true);
      });
    });

    describe('getAndDeleteChallenge', () => {
      it('should retrieve and delete a valid challenge', async () => {
        const trx = getTestTransaction();
        const challenge = randomBytes(32);

        await createTestChallenge(trx, {
          challenge,
          email: 'test@example.com',
          challenge_type: 'registration',
          expires_at: moment().add(5, 'minutes').toDate(),
        });

        const result = await service.getAndDeleteChallenge(
          challenge.toString('base64url'),
        );

        expect(result).not.toBeNull();
        expect(result!.email).toBe('test@example.com');
        expect(result!.challenge_type).toBe('registration');

        // Verify it was deleted
        const remaining = await trx('webauthn_challenges')
          .where('email', 'test@example.com')
          .first();
        expect(remaining).toBeUndefined();
      });

      it('should return null for expired challenge', async () => {
        const trx = getTestTransaction();
        const challenge = randomBytes(32);

        await createTestChallenge(trx, {
          challenge,
          email: 'test@example.com',
          challenge_type: 'registration',
          expires_at: moment().subtract(1, 'minute').toDate(),
        });

        const result = await service.getAndDeleteChallenge(
          challenge.toString('base64url'),
        );

        expect(result).toBeNull();
      });

      it('should return null for non-existent challenge', async () => {
        const result = await service.getAndDeleteChallenge(
          randomBytes(32).toString('base64url'),
        );

        expect(result).toBeNull();
      });
    });
  });

  describe('User Lookup', () => {
    describe('getUserByEmail', () => {
      it('should return user when found', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const result = await service.getUserByEmail('test@example.com');

        expect(result).not.toBeNull();
        expect(result!.id_user).toBe(user.id_user);
        expect(result!.email).toBe('test@example.com');
        expect(result!.external_id).toBe(user.external_id);
      });

      it('should return null for non-existent email', async () => {
        const result = await service.getUserByEmail('nonexistent@example.com');
        expect(result).toBeNull();
      });

      it('should return null for inactive user', async () => {
        const trx = getTestTransaction();
        await createTestUser(trx, {
          email: 'inactive@example.com',
          active: false,
        });

        const result = await service.getUserByEmail('inactive@example.com');
        expect(result).toBeNull();
      });
    });

    describe('getUserByCredentialId', () => {
      it('should return user when credential found', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });
        const authMethod = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'credential-id-123',
        });
        const credentialId = randomBytes(32);
        await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod.id_auth_method,
          credential_id: credentialId,
          public_key: randomBytes(65),
        });

        const result = await service.getUserByCredentialId(credentialId);

        expect(result).not.toBeNull();
        expect(result!.id_user).toBe(user.id_user);
        expect(result!.email).toBe('test@example.com');
      });

      it('should return null for inactive credential', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });
        const authMethod = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'credential-id-inactive',
        });
        const credentialId = randomBytes(32);
        await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod.id_auth_method,
          credential_id: credentialId,
          public_key: randomBytes(65),
          active: false,
        });

        const result = await service.getUserByCredentialId(credentialId);
        expect(result).toBeNull();
      });

      it('should return null for non-existent credential', async () => {
        const result = await service.getUserByCredentialId(randomBytes(32));
        expect(result).toBeNull();
      });
    });
  });

  describe('Credential Management', () => {
    describe('getUserPasskeys', () => {
      it('should return all active passkeys for user', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        // Create two passkeys
        const authMethod1 = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-1',
        });
        await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod1.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
          device_name: 'iPhone',
        });

        const authMethod2 = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-2',
        });
        await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod2.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
          device_name: 'MacBook',
        });

        const passkeys = await service.getUserPasskeys(user.id_user);

        expect(passkeys).toHaveLength(2);
        const deviceNames = passkeys.map((p) => p.device_name);
        expect(deviceNames).toContain('iPhone');
        expect(deviceNames).toContain('MacBook');
      });

      it('should not return inactive passkeys', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const authMethod = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-inactive',
        });
        await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
          active: false,
        });

        const passkeys = await service.getUserPasskeys(user.id_user);
        expect(passkeys).toHaveLength(0);
      });

      it('should return empty array for user with no passkeys', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const passkeys = await service.getUserPasskeys(user.id_user);
        expect(passkeys).toHaveLength(0);
      });
    });

    describe('deletePasskey', () => {
      it('should soft delete passkey when user has multiple auth methods', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        // Create Apple auth method
        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-sub-123',
          is_primary: true,
        });

        // Create passkey
        const passkeyAuthMethod = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-to-delete',
        });
        const passkey = await createTestPasskeyCredential(trx, {
          auth_method_id: passkeyAuthMethod.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
        });

        const result = await service.deletePasskey({
          user_id: user.id_user,
          passkey_id: passkey.id_passkey,
        });

        expect(result).toBe(true);

        // Verify soft delete
        const deletedPasskey = await trx('passkey_credentials')
          .where('id_passkey', passkey.id_passkey)
          .first();
        expect(deletedPasskey.active).toBe(false);

        const deletedAuthMethod = await trx('auth_methods')
          .where('id_auth_method', passkeyAuthMethod.id_auth_method)
          .first();
        expect(deletedAuthMethod.active).toBe(false);
      });

      it('should throw error when trying to delete last auth method', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        // Only one auth method (passkey)
        const authMethod = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'only-passkey',
        });
        const passkey = await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
        });

        await expect(
          service.deletePasskey({
            user_id: user.id_user,
            passkey_id: passkey.id_passkey,
          }),
        ).rejects.toThrow('Cannot delete last authentication method');
      });

      it('should return false when passkey not found', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const result = await service.deletePasskey({
          user_id: user.id_user,
          passkey_id: 99999,
        });

        expect(result).toBe(false);
      });

      it('should return false when passkey belongs to different user', async () => {
        const trx = getTestTransaction();
        const user1 = await createTestUser(trx, { email: 'user1@example.com' });
        const user2 = await createTestUser(trx, { email: 'user2@example.com' });

        // Create passkey for user2
        const authMethod = await createTestAuthMethod(trx, {
          user_id: user2.id_user,
          auth_type: 'passkey',
          external_id: 'user2-passkey',
        });
        const passkey = await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
        });

        // Try to delete as user1
        const result = await service.deletePasskey({
          user_id: user1.id_user,
          passkey_id: passkey.id_passkey,
        });

        expect(result).toBe(false);
      });
    });

    describe('renamePasskey', () => {
      it('should rename passkey successfully', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const authMethod = await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-to-rename',
        });
        const passkey = await createTestPasskeyCredential(trx, {
          auth_method_id: authMethod.id_auth_method,
          credential_id: randomBytes(32),
          public_key: randomBytes(65),
          device_name: 'Old Name',
        });

        const result = await service.renamePasskey({
          user_id: user.id_user,
          passkey_id: passkey.id_passkey,
          device_name: 'New Name',
        });

        expect(result).toBe(true);

        const renamed = await trx('passkey_credentials')
          .where('id_passkey', passkey.id_passkey)
          .first();
        expect(renamed.device_name).toBe('New Name');
      });

      it('should return false when passkey not found', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const result = await service.renamePasskey({
          user_id: user.id_user,
          passkey_id: 99999,
          device_name: 'New Name',
        });

        expect(result).toBe(false);
      });
    });
  });

  describe('Auth Method Management', () => {
    describe('getUserAuthMethods', () => {
      it('should return all active auth methods', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-sub-123',
          is_primary: true,
        });
        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-123',
        });

        const authMethods = await service.getUserAuthMethods(user.id_user);

        expect(authMethods).toHaveLength(2);
        expect(authMethods.map((m) => m.auth_type).sort()).toEqual([
          'apple',
          'passkey',
        ]);
      });

      it('should not return inactive auth methods', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await trx('auth_methods').insert({
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'inactive-apple',
          active: false,
        });

        const authMethods = await service.getUserAuthMethods(user.id_user);
        expect(authMethods).toHaveLength(0);
      });
    });

    describe('getAuthMethodCount', () => {
      it('should return correct count of active auth methods', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple-123',
        });
        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-123',
        });
        // Add inactive one
        await trx('auth_methods').insert({
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'inactive-passkey',
          active: false,
        });

        const count = await service.getAuthMethodCount(user.id_user);
        expect(count).toBe(2);
      });

      it('should return 0 for user with no auth methods', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const count = await service.getAuthMethodCount(user.id_user);
        expect(count).toBe(0);
      });
    });
  });

  describe('RevenueCat Integration', () => {
    describe('getRevenueCatId', () => {
      it('should return Apple ID when user has Apple auth method', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple.user.12345',
        });

        const revenueCatId = await service.getRevenueCatId(
          user.id_user,
          user.external_id,
        );

        expect(revenueCatId).toBe('apple.user.12345');
      });

      it('should return external_id when user has only passkey auth', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-123',
        });

        const revenueCatId = await service.getRevenueCatId(
          user.id_user,
          user.external_id,
        );

        expect(revenueCatId).toBe(user.external_id);
      });

      it('should prioritize Apple ID over external_id', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        // User has both Apple and passkey auth methods
        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'apple.user.99999',
        });
        await createTestAuthMethod(trx, {
          user_id: user.id_user,
          auth_type: 'passkey',
          external_id: 'passkey-999',
        });

        const revenueCatId = await service.getRevenueCatId(
          user.id_user,
          user.external_id,
        );

        expect(revenueCatId).toBe('apple.user.99999');
      });

      it('should return external_id when Apple auth method is inactive', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await trx('auth_methods').insert({
          user_id: user.id_user,
          auth_type: 'apple',
          external_id: 'inactive.apple.id',
          active: false,
        });

        const revenueCatId = await service.getRevenueCatId(
          user.id_user,
          user.external_id,
        );

        expect(revenueCatId).toBe(user.external_id);
      });
    });
  });

  describe('Subscription Check', () => {
    describe('hasSubscription', () => {
      it('should return true when user has active subscription', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await createTestUserParam(trx, {
          user_id: user.id_user,
          param: 'subscription',
          value: 'pro_yearly',
        });

        const hasSub = await service.hasSubscription(user.id_user);
        expect(hasSub).toBe(true);
      });

      it('should return false when user has no subscription', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const hasSub = await service.hasSubscription(user.id_user);
        expect(hasSub).toBe(false);
      });

      it('should return false when subscription is inactive', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        await createTestUserParam(trx, {
          user_id: user.id_user,
          param: 'subscription',
          value: 'pro_yearly',
          active: false,
        });

        const hasSub = await service.hasSubscription(user.id_user);
        expect(hasSub).toBe(false);
      });
    });
  });

  describe('Token Generation', () => {
    describe('generateToken', () => {
      it('should generate a valid JWT token', async () => {
        const trx = getTestTransaction();
        const user = await createTestUser(trx, { email: 'test@example.com' });

        const token = await service.generateToken({
          id_user: user.id_user,
          email: user.email,
          external_id: user.external_id,
          active: true,
        });

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

        // Decode and verify payload
        const JWT = require('jsonwebtoken');
        const decoded = JWT.verify(token, process.env.APP_SECRET);

        expect(decoded.id_user).toBe(user.id_user);
        expect(decoded.email).toBe(user.email);
        expect(decoded.external_id).toBe(user.external_id);
        expect(decoded.time).toBeDefined();
      });
    });
  });
});
