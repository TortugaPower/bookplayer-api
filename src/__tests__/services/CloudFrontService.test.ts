import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  jest,
} from '@jest/globals';
import crypto from 'crypto';
import { CloudFrontService } from '../../services/CloudFrontService';
import { mockLoggerService } from '../setup';

describe('CloudFrontService', () => {
  let service: CloudFrontService;
  const ORIGINAL_ENV = { ...process.env };

  // A throwaway RSA key pair so the signer has a valid PEM to work with.
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  beforeEach(() => {
    process.env.CLOUDFRONT_URL = 'https://library.bookplayer.app';
    process.env.CLOUDFRONT_KEY_PAIR_ID = 'K2ABCDEF1234XY';
    process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;
    service = new CloudFrontService();
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('signs a URL with the CloudFront host, path and signature params', () => {
    const result = service.getSignedUrl('apple.sub.123/library/123_MyBook.m4b');

    expect(result).not.toBeNull();
    const url = new URL(result!.url);
    expect(url.origin).toBe('https://library.bookplayer.app');
    expect(url.pathname).toBe('/apple.sub.123/library/123_MyBook.m4b');
    expect(url.searchParams.get('Key-Pair-Id')).toBe('K2ABCDEF1234XY');
    expect(url.searchParams.get('Signature')).toBeTruthy();
    expect(url.searchParams.get('Expires')).toBeTruthy();
    expect(result!.expires_in).toBeGreaterThan(0);
  });

  it('encodes path segments but keeps the slash separators (legacy email prefix)', () => {
    const result = service.getSignedUrl('user@icloud.com/library/My Book.m4b');

    const url = new URL(result!.url);
    // '@' and the space are percent-encoded; '/' separators are preserved.
    expect(url.pathname).toBe('/user%40icloud.com/library/My%20Book.m4b');
  });

  it('honours a custom expiry', () => {
    const before = Math.floor(Date.now() / 1000);
    const result = service.getSignedUrl('a/b.m4b', 60);
    expect(result!.expires_in).toBeGreaterThanOrEqual(before + 59);
    expect(result!.expires_in).toBeLessThanOrEqual(before + 120);
  });

  it('uses CLOUDFRONT_EXPIRY_SECONDS as the default when set', () => {
    process.env.CLOUDFRONT_EXPIRY_SECONDS = '120';
    const before = Math.floor(Date.now() / 1000);
    const result = service.getSignedUrl('a/b.m4b'); // no explicit expiry
    expect(result!.expires_in).toBeGreaterThanOrEqual(before + 110);
    expect(result!.expires_in).toBeLessThanOrEqual(before + 180);
    delete process.env.CLOUDFRONT_EXPIRY_SECONDS;
  });

  it('falls back to 24h when CLOUDFRONT_EXPIRY_SECONDS is invalid', () => {
    process.env.CLOUDFRONT_EXPIRY_SECONDS = 'not-a-number';
    const before = Math.floor(Date.now() / 1000);
    const result = service.getSignedUrl('a/b.m4b');
    expect(result!.expires_in).toBeGreaterThan(before + 86000);
    delete process.env.CLOUDFRONT_EXPIRY_SECONDS;
  });

  it('returns null (and logs) when signing config is missing', () => {
    delete process.env.CLOUDFRONT_PRIVATE_KEY;

    expect(service.getSignedUrl('a/b.m4b')).toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalled();
  });
});
