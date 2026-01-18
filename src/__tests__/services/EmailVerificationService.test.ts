import { describe, it, expect, beforeEach } from '@jest/globals';
import { EmailVerificationService } from '../../services/EmailVerificationService';
import {
  getTestTransaction,
  mockEmailService,
  mockLoggerService,
  mockUserService,
  createTestVerificationCode,
} from '../setup';
import moment from 'moment';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  beforeEach(() => {
    // Create service with mocked dependencies
    service = new EmailVerificationService();
    // Inject mocks
    (service as any)._emailService = mockEmailService;
    (service as any)._logger = mockLoggerService;
    (service as any)._userService = mockUserService;
    (service as any).db = getTestTransaction();

    // Clear mock calls
    mockEmailService.sendEmail.mockClear();
    mockLoggerService.log.mockClear();
    mockUserService.GetUser.mockClear();
    mockUserService.GetUser.mockResolvedValue(null); // Default: no existing user
  });

  describe('sendVerificationCode', () => {
    it('should send code and store in database', async () => {
      const email = 'test@example.com';

      const result = await service.sendVerificationCode(email);

      expect(result.success).toBe(true);
      expect(result.expires_in).toBe(300); // 5 minutes in seconds
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: email.toLowerCase(),
          subject: expect.stringContaining('verification'),
        }),
      );

      // Verify code was stored in database
      const trx = getTestTransaction();
      const storedCode = await trx('email_verification_codes')
        .where('email', email.toLowerCase())
        .first();

      expect(storedCode).toBeDefined();
      expect(storedCode.code).toHaveLength(6);
      expect(storedCode.verified).toBe(false);
      expect(storedCode.attempts).toBe(0);
    });

    it('should normalize email to lowercase', async () => {
      const email = 'TeSt@ExAmPlE.COM';

      await service.sendVerificationCode(email);

      const trx = getTestTransaction();
      const storedCode = await trx('email_verification_codes')
        .where('email', 'test@example.com')
        .first();

      expect(storedCode).toBeDefined();
    });

    it('should invalidate previous unverified codes', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      // Create an existing unverified code
      await createTestVerificationCode(trx, {
        email,
        code: '111111',
        expires_at: moment().add(5, 'minutes').toDate(),
        verified: false,
      });

      // Send new code
      await service.sendVerificationCode(email);

      // Old code should be deleted
      const codes = await trx('email_verification_codes')
        .where('email', email.toLowerCase())
        .select();

      expect(codes).toHaveLength(1);
      expect(codes[0].code).not.toBe('111111');
    });

    it('should rate limit after 3 codes per hour', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      // Create 3 existing codes within the last hour
      for (let i = 0; i < 3; i++) {
        await trx('email_verification_codes').insert({
          email: email.toLowerCase(),
          code: `${i}${i}${i}${i}${i}${i}`,
          expires_at: moment().add(5, 'minutes').toDate(),
          verified: true, // Mark as verified so they won't be deleted
          created_at: moment().subtract(30, 'minutes').toDate(),
        });
      }

      const result = await service.sendVerificationCode(email);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many');
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should allow sending after rate limit window expires', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      // Create 3 codes from 2 hours ago (outside rate limit window)
      for (let i = 0; i < 3; i++) {
        await trx('email_verification_codes').insert({
          email: email.toLowerCase(),
          code: `${i}${i}${i}${i}${i}${i}`,
          expires_at: moment().subtract(1, 'hour').toDate(),
          verified: true,
          created_at: moment().subtract(2, 'hours').toDate(),
        });
      }

      const result = await service.sendVerificationCode(email);

      expect(result.success).toBe(true);
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyCode', () => {
    it('should return verification token for correct code', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';
      const code = '123456';

      await createTestVerificationCode(trx, {
        email,
        code,
        expires_at: moment().add(5, 'minutes').toDate(),
      });

      const result = await service.verifyCode(email, code);

      expect(result.verified).toBe(true);
      expect(result.verification_token).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify code was marked as verified
      const storedCode = await trx('email_verification_codes')
        .where('email', email.toLowerCase())
        .first();
      expect(storedCode.verified).toBe(true);
    });

    it('should increment attempts on wrong code', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      await createTestVerificationCode(trx, {
        email,
        code: '123456',
        expires_at: moment().add(5, 'minutes').toDate(),
        attempts: 0,
      });

      const result = await service.verifyCode(email, '000000');

      expect(result.verified).toBe(false);
      expect(result.error).toContain('4 attempts remaining');

      const storedCode = await trx('email_verification_codes')
        .where('email', email.toLowerCase())
        .first();
      expect(storedCode.attempts).toBe(1);
    });

    it('should delete code after max attempts', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      await createTestVerificationCode(trx, {
        email,
        code: '123456',
        expires_at: moment().add(5, 'minutes').toDate(),
        attempts: 5, // Already at max attempts - next verify call will delete
      });

      const result = await service.verifyCode(email, '000000');

      expect(result.verified).toBe(false);
      expect(result.error).toContain('Too many incorrect attempts');

      // Code should be deleted
      const storedCode = await trx('email_verification_codes')
        .where('email', email.toLowerCase())
        .first();
      expect(storedCode).toBeUndefined();
    });

    it('should return error for expired code', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      await createTestVerificationCode(trx, {
        email,
        code: '123456',
        expires_at: moment().subtract(1, 'minute').toDate(), // Expired
      });

      const result = await service.verifyCode(email, '123456');

      expect(result.verified).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should return error for non-existent code', async () => {
      const result = await service.verifyCode(
        'nonexistent@example.com',
        '123456',
      );

      expect(result.verified).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should be case-insensitive for email', async () => {
      const trx = getTestTransaction();

      await createTestVerificationCode(trx, {
        email: 'test@example.com',
        code: '123456',
        expires_at: moment().add(5, 'minutes').toDate(),
      });

      const result = await service.verifyCode('TEST@EXAMPLE.COM', '123456');

      expect(result.verified).toBe(true);
    });
  });

  describe('validateVerificationToken', () => {
    it('should return valid for correct token', async () => {
      const trx = getTestTransaction();
      const email = 'test@example.com';

      // First create and verify a code to get a token
      await createTestVerificationCode(trx, {
        email,
        code: '123456',
        expires_at: moment().add(5, 'minutes').toDate(),
      });

      const verifyResult = await service.verifyCode(email, '123456');
      const token = verifyResult.verification_token!;

      const result = await service.validateVerificationToken(token);

      expect(result.valid).toBe(true);
      expect(result.email).toBe(email);
    });

    it('should return error for expired token', async () => {
      // Create an expired token manually
      const JWT = require('jsonwebtoken');
      const expiredToken = JWT.sign(
        {
          email: 'test@example.com',
          verified: true,
          exp: moment().subtract(1, 'minute').unix(),
        },
        process.env.APP_SECRET,
      );

      const result = await service.validateVerificationToken(expiredToken);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should return error for invalid token', async () => {
      const result = await service.validateVerificationToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should return error for token with wrong secret', async () => {
      const JWT = require('jsonwebtoken');
      const wrongSecretToken = JWT.sign(
        {
          email: 'test@example.com',
          verified: true,
          exp: moment().add(15, 'minutes').unix(),
        },
        'wrong-secret',
      );

      const result = await service.validateVerificationToken(wrongSecretToken);

      expect(result.valid).toBe(false);
    });
  });

  describe('cleanupExpiredCodes', () => {
    it('should delete expired codes and return count', async () => {
      const trx = getTestTransaction();

      // Get baseline count of expired codes (in case of leftover data)
      const baselineExpired = await trx('email_verification_codes')
        .where('expires_at', '<', new Date())
        .count('id as count')
        .first();
      const baselineCount = parseInt(baselineExpired?.count as string, 10) || 0;

      // Create expired codes
      await createTestVerificationCode(trx, {
        email: 'expired1@example.com',
        code: '111111',
        expires_at: moment().subtract(1, 'hour').toDate(),
      });
      await createTestVerificationCode(trx, {
        email: 'expired2@example.com',
        code: '222222',
        expires_at: moment().subtract(30, 'minutes').toDate(),
      });

      // Create valid code
      await createTestVerificationCode(trx, {
        email: 'valid@example.com',
        code: '333333',
        expires_at: moment().add(5, 'minutes').toDate(),
      });

      const deletedCount = await service.cleanupExpiredCodes();

      // Should delete at least the 2 we just created (plus any pre-existing expired)
      expect(deletedCount).toBe(baselineCount + 2);

      // Valid code should still exist
      const validCode = await trx('email_verification_codes')
        .where('email', 'valid@example.com')
        .first();
      expect(validCode).toBeDefined();
    });
  });
});
