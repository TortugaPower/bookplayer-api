import crypto from 'crypto';
import { inject, injectable } from 'inversify';
import JWT from 'jsonwebtoken';
import moment from 'moment';
import database from '../database';
import { TYPES } from '../ContainerTypes';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IEmailService } from '../interfaces/IEmailService';
import { IEmailVerificationService } from '../interfaces/IEmailVerificationService';
import { IUserService } from '../interfaces/IUserService';

@injectable()
export class EmailVerificationService implements IEmailVerificationService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  @inject(TYPES.EmailService)
  private _emailService: IEmailService;

  @inject(TYPES.UserServices)
  private _userService: IUserService;

  private db = database;

  // Configuration
  private readonly CODE_LENGTH = 6;
  private readonly CODE_EXPIRY_MINUTES = 5;
  private readonly MAX_ATTEMPTS = 5;
  private readonly RATE_LIMIT_PER_HOUR = 3;
  private readonly VERIFICATION_TOKEN_EXPIRY_MINUTES = 15;

  /**
   * Generate a random 6-digit code
   */
  private generateCode(): string {
    return crypto
      .randomInt(0, 999999)
      .toString()
      .padStart(this.CODE_LENGTH, '0');
  }

  /**
   * Check rate limiting - max 3 codes per email per hour
   */
  private async isRateLimited(email: string): Promise<boolean> {
    const oneHourAgo = moment().subtract(1, 'hour').toDate();

    const recentCodes = await this.db('email_verification_codes')
      .where('email', email.toLowerCase())
      .where('created_at', '>', oneHourAgo)
      .count('id as count')
      .first();

    return (
      parseInt(recentCodes?.count as string, 10) >= this.RATE_LIMIT_PER_HOUR
    );
  }

  /**
   * Send a verification code to the email
   */
  async sendVerificationCode(
    email: string,
  ): Promise<{ success: boolean; expires_in: number; error?: string; error_code?: string }> {
    try {
      const normalizedEmail = email.toLowerCase().trim();

      // Check if email already exists in the database
      const existingUser = await this._userService.GetUser({ email: normalizedEmail });
      if (existingUser) {
        return {
          success: false,
          expires_in: 0,
          error: 'An account with this email already exists. Please sign in instead.',
          error_code: 'EMAIL_ALREADY_REGISTERED',
        };
      }

      // Check rate limiting
      if (await this.isRateLimited(normalizedEmail)) {
        return {
          success: false,
          expires_in: 0,
          error: 'Too many verification attempts. Please try again later.',
        };
      }

      // Invalidate any existing codes for this email
      await this.db('email_verification_codes')
        .where('email', normalizedEmail)
        .where('verified', false)
        .del();

      // Generate new code
      const code = this.generateCode();
      const expiresAt = moment()
        .add(this.CODE_EXPIRY_MINUTES, 'minutes')
        .toDate();

      // Store code in database
      await this.db('email_verification_codes').insert({
        email: normalizedEmail,
        code,
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
      });

      // Send email
      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; margin-bottom: 20px;">Your BookPlayer verification code</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">
            Use the following code to verify your email address:
          </p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${code}</span>
          </div>
          <p style="color: #999; font-size: 14px;">
            This code expires in ${this.CODE_EXPIRY_MINUTES} minutes.
          </p>
          <p style="color: #999; font-size: 14px;">
            If you didn't request this code, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px;">
            — The BookPlayer Team
          </p>
        </div>
      `;

      await this._emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Your BookPlayer verification code',
        html: emailHtml,
      });

      this._logger.log({
        origin: 'EmailVerificationService.sendVerificationCode',
        message: 'Verification code sent',
        data: { email: normalizedEmail },
      });

      return {
        success: true,
        expires_in: this.CODE_EXPIRY_MINUTES * 60, // seconds
      };
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationService.sendVerificationCode',
        message: err.message,
        data: { email },
      });
      return {
        success: false,
        expires_in: 0,
        error: 'Failed to send verification code. Please try again.',
      };
    }
  }

  /**
   * Verify the code entered by the user
   */
  async verifyCode(
    email: string,
    code: string,
  ): Promise<{
    verified: boolean;
    verification_token?: string;
    error?: string;
  }> {
    try {
      const normalizedEmail = email.toLowerCase().trim();

      // Find the most recent unexpired code for this email
      const record = await this.db('email_verification_codes')
        .where('email', normalizedEmail)
        .where('verified', false)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .first();

      if (!record) {
        return {
          verified: false,
          error:
            'Verification code expired or not found. Please request a new code.',
        };
      }

      // Check max attempts
      if (record.attempts >= this.MAX_ATTEMPTS) {
        // Delete the code after max attempts
        await this.db('email_verification_codes').where('id', record.id).del();

        return {
          verified: false,
          error: 'Too many incorrect attempts. Please request a new code.',
        };
      }

      // Increment attempts
      await this.db('email_verification_codes')
        .where('id', record.id)
        .increment('attempts', 1);

      // Check if code matches
      if (record.code !== code) {
        const remainingAttempts = this.MAX_ATTEMPTS - record.attempts - 1;
        return {
          verified: false,
          error:
            remainingAttempts > 0
              ? `Incorrect code. ${remainingAttempts} attempts remaining.`
              : 'Incorrect code. Please request a new code.',
        };
      }

      // Code is correct - mark as verified
      await this.db('email_verification_codes').where('id', record.id).update({
        verified: true,
        updated_at: new Date(),
      });

      // Generate verification token (JWT)
      const verificationToken = JWT.sign(
        {
          email: normalizedEmail,
          verified: true,
          exp: moment()
            .add(this.VERIFICATION_TOKEN_EXPIRY_MINUTES, 'minutes')
            .unix(),
        },
        process.env.APP_SECRET,
      );

      this._logger.log({
        origin: 'EmailVerificationService.verifyCode',
        message: 'Email verified successfully',
        data: { email: normalizedEmail },
      });

      return {
        verified: true,
        verification_token: verificationToken,
      };
    } catch (err) {
      this._logger.log({
        origin: 'EmailVerificationService.verifyCode',
        message: err.message,
        data: { email },
      });
      return {
        verified: false,
        error: 'Verification failed. Please try again.',
      };
    }
  }

  /**
   * Validate a verification token (used by passkey registration)
   */
  async validateVerificationToken(
    token: string,
  ): Promise<{ valid: boolean; email?: string; error?: string }> {
    try {
      const decoded = JWT.verify(token, process.env.APP_SECRET) as {
        email: string;
        verified: boolean;
        exp: number;
      };

      if (!decoded.verified || !decoded.email) {
        return { valid: false, error: 'Invalid verification token' };
      }

      return {
        valid: true,
        email: decoded.email,
      };
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return {
          valid: false,
          error: 'Verification token expired. Please verify your email again.',
        };
      }
      return { valid: false, error: 'Invalid verification token' };
    }
  }

  /**
   * Cleanup expired codes (can be called periodically)
   */
  async cleanupExpiredCodes(): Promise<number> {
    const result = await this.db('email_verification_codes')
      .where('expires_at', '<', new Date())
      .del();

    return result;
  }
}
