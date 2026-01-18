export interface IEmailVerificationService {
  sendVerificationCode(
    email: string,
  ): Promise<{ success: boolean; expires_in: number; error?: string; error_code?: string }>;
  verifyCode(
    email: string,
    code: string,
  ): Promise<{
    verified: boolean;
    verification_token?: string;
    error?: string;
  }>;
  validateVerificationToken(
    token: string,
  ): Promise<{ valid: boolean; email?: string; error?: string }>;
}
