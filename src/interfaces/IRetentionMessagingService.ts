import { DecodedRealtimeRequestBody } from '../types/retentionMessaging';

export interface IRetentionMessagingService {
  /**
   * Verify and decode the JWS signed payload from Apple.
   * @param signedPayload The JWS signed payload string.
   * @returns The decoded DecodedRealtimeRequestBody or throws if verification fails.
   */
  VerifyAndDecodeRequest(signedPayload: string): Promise<DecodedRealtimeRequestBody>;

  /**
   * Select the appropriate retention message ID based on the request.
   * @param request The decoded request body from Apple.
   * @returns The message ID to display, or null to use Apple's default.
   */
  SelectRetentionMessage(request: DecodedRealtimeRequestBody): Promise<string | null>;
}
