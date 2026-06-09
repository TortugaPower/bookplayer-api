import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import moment from 'moment';
import { logger } from './LoggerService';

/**
 * Issues CloudFront signed URLs for downloads from the `library.bookplayer.app`
 * distribution (origin = the private library S3 bucket via OAC).
 *
 * The S3 object key maps directly onto the CloudFront URL path, so callers pass
 * the same key they would hand to S3. Uses a canned policy (single resource +
 * expiry), matching the per-object scope of the S3 presigned URLs it replaces.
 *
 * Config comes from env (wired in prod via Secrets Manager + task-definition):
 *   CLOUDFRONT_URL           e.g. https://library.bookplayer.app
 *   CLOUDFRONT_KEY_PAIR_ID   the public key id registered in the key group
 *   CLOUDFRONT_PRIVATE_KEY   PEM private key (PKCS#8) for that key pair
 */
export class CloudFrontService {
  private readonly _logger = logger;

  /**
   * Default signed-URL lifetime: 24 hours. Long enough to cover a new device
   * loading all its artwork after a single library sync (artwork is cached
   * locally forever after the first successful fetch), and a long streaming
   * playback session (AVURLAsset re-fetches ranges with the same URL, so a
   * shorter expiry would stall playback mid-listen).
   *
   * Overridable via `CLOUDFRONT_EXPIRY_SECONDS` (e.g. set low temporarily to
   * observe client behaviour when a URL expires). Falls back to 24h if unset
   * or invalid.
   */
  static readonly DEFAULT_EXPIRY_SECONDS = 86400;

  private static resolveDefaultExpiry(): number {
    const parsed = parseInt(process.env.CLOUDFRONT_EXPIRY_SECONDS ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : CloudFrontService.DEFAULT_EXPIRY_SECONDS;
  }

  getSignedUrl(
    key: string,
    expiresIn?: number,
  ): { url: string; expires_in: number } | null {
    try {
      const ttl = expiresIn ?? CloudFrontService.resolveDefaultExpiry();
      const baseUrl = process.env.CLOUDFRONT_URL;
      const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
      const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
      if (!baseUrl || !keyPairId || !privateKey) {
        throw new Error(
          'CloudFront signing is not configured (missing CLOUDFRONT_URL, ' +
            'CLOUDFRONT_KEY_PAIR_ID or CLOUDFRONT_PRIVATE_KEY)',
        );
      }

      // Encode each path segment but keep the '/' separators, so the decoded
      // request path CloudFront forwards to S3 equals the object key exactly.
      const encodedPath = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const resourceUrl = `${baseUrl.replace(/\/+$/, '')}/${encodedPath}`;
      const expires = moment().add(ttl, 'seconds');

      const url = getSignedUrl({
        url: resourceUrl,
        keyPairId,
        privateKey,
        dateLessThan: expires.toISOString(),
      });
      return { url, expires_in: expires.unix() };
    } catch (error) {
      this._logger.log({
        origin: 'CloudFrontService.getSignedUrl',
        message: error.message,
        data: { key },
      });
      return null;
    }
  }
}
