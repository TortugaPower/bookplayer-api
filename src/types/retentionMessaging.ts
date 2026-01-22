/**
 * Apple Retention Messaging API Types
 * Based on: https://developer.apple.com/documentation/retentionmessaging
 */

// Re-export the DecodedRealtimeRequestBody from Apple's library
export { DecodedRealtimeRequestBody } from '@apple/app-store-server-library';

/**
 * The response body to return to Apple's Retention Messaging API.
 */
export interface RealtimeResponseBody {
  /** The ID of the pre-approved retention message to display. */
  messageId: string;
}

/**
 * Configuration for retention message selection.
 */
export interface RetentionMessageConfig {
  /** The default message ID to use when no specific locale match is found. */
  defaultMessageId: string | null;
  /** Optional locale-specific message IDs. */
  localeMessages?: Record<string, string>;
}
