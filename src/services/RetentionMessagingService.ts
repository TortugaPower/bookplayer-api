import { injectable, inject } from 'inversify';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import * as fs from 'fs';
import * as path from 'path';
import { TYPES } from '../ContainerTypes';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IRetentionMessagingService } from '../interfaces/IRetentionMessagingService';
import { DecodedRealtimeRequestBody } from '../types/retentionMessaging';

@injectable()
export class RetentionMessagingService implements IRetentionMessagingService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  private _verifier: SignedDataVerifier | null = null;

  private getVerifier(): SignedDataVerifier {
    if (this._verifier) {
      return this._verifier;
    }

    const bundleId = process.env.APPLE_BUNDLE_ID;
    const appAppleId = Number(process.env.APPLE_APP_APPLE_ID);
    const environment =
      process.env.APPLE_ENVIRONMENT === 'Sandbox'
        ? Environment.SANDBOX
        : Environment.PRODUCTION;

    // Load Apple root certificates
    const certsDir = path.join(process.cwd(), 'certs');
    const appleRootCAs: Buffer[] = [];

    try {
      const certFiles = fs.readdirSync(certsDir).filter((f) => f.endsWith('.cer'));
      for (const certFile of certFiles) {
        const certPath = path.join(certsDir, certFile);
        appleRootCAs.push(fs.readFileSync(certPath));
      }
    } catch (err) {
      this._logger.log({
        origin: 'RetentionMessagingService.getVerifier',
        message: `Failed to load Apple root certificates: ${err.message}`,
      });
    }

    if (appleRootCAs.length === 0) {
      throw new Error('No Apple root certificates found in certs directory');
    }

    this._verifier = new SignedDataVerifier(
      appleRootCAs,
      true, // enableOnlineChecks
      environment,
      bundleId,
      appAppleId,
    );

    return this._verifier;
  }

  async VerifyAndDecodeRequest(signedPayload: string): Promise<DecodedRealtimeRequestBody> {
    try {
      const verifier = this.getVerifier();
      const decodedRequest = await verifier.verifyAndDecodeRealtimeRequest(signedPayload);
      return decodedRequest;
    } catch (err) {
      this._logger.log({
        origin: 'RetentionMessagingService.VerifyAndDecodeRequest',
        message: err.message,
        data: { signedPayload: signedPayload?.substring(0, 50) + '...' },
      });
      throw err;
    }
  }

  async SelectRetentionMessage(request: DecodedRealtimeRequestBody): Promise<string | null> {
    try {
      const defaultMessageId = process.env.APPLE_DEFAULT_RETENTION_MESSAGE_ID;

      if (!defaultMessageId) {
        // Return null to let Apple use its default fallback message
        this._logger.log({
          origin: 'RetentionMessagingService.SelectRetentionMessage',
          message: 'No default retention message ID configured',
          data: { userLocale: request.userLocale, productId: request.productId },
        });
        return null;
      }

      // Future enhancement: Add locale-specific message selection
      // e.g., process.env[`APPLE_RETENTION_MESSAGE_${request.userLocale}`] || defaultMessageId

      return defaultMessageId;
    } catch (err) {
      this._logger.log({
        origin: 'RetentionMessagingService.SelectRetentionMessage',
        message: err.message,
        data: { request },
      });
      return null;
    }
  }
}
