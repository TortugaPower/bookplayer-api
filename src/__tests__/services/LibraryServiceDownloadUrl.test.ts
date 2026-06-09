import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { mockLoggerService } from '../setup';

/**
 * Covers the CloudFront-vs-S3 decision in LibraryService.getDownloadUrl:
 * allowlist OR global flag -> CloudFront; otherwise S3; and S3 fallback when
 * CloudFront signing fails.
 */
describe('LibraryService.getDownloadUrl', () => {
  let service: LibraryService;
  let config: any;
  let cloudfront: any;
  let storage: any;

  const CF = { url: 'https://library.bookplayer.app/k?Signature=x', expires_in: 1 };
  const S3 = { url: 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=y', expires_in: 2 };
  const user = { id_user: 29, email: 'x@y.com' } as any;
  const key = 'prefix/file.mp3';

  // getDownloadUrl is private; reach it through the instance.
  const call = (u: any = user) => (service as any).getDownloadUrl(key, u);

  beforeEach(() => {
    delete process.env.CLOUDFRONT_ALLOWLIST;
    config = { getBoolean: jest.fn() };
    cloudfront = { getSignedUrl: jest.fn() };
    storage = { getPresignedUrl: jest.fn() };
    config.getBoolean.mockResolvedValue(false);
    cloudfront.getSignedUrl.mockReturnValue(CF);
    storage.getPresignedUrl.mockResolvedValue(S3);
    service = new LibraryService();
    (service as any)._config = config;
    (service as any)._cloudfront = cloudfront;
    (service as any)._storage = storage;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  afterEach(() => {
    delete process.env.CLOUDFRONT_ALLOWLIST;
  });

  it('uses CloudFront when the user is allowlisted (flag off, no config read)', async () => {
    process.env.CLOUDFRONT_ALLOWLIST = '10, 29 ,42';
    expect(await call()).toEqual(CF);
    expect(cloudfront.getSignedUrl).toHaveBeenCalledWith(key);
    expect(config.getBoolean).not.toHaveBeenCalled(); // short-circuits before the async read
    expect(storage.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('uses CloudFront when the global flag is on', async () => {
    config.getBoolean.mockResolvedValue(true);
    expect(await call()).toEqual(CF);
    expect(cloudfront.getSignedUrl).toHaveBeenCalled();
    expect(storage.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('uses S3 presigned when flag is off and user not allowlisted', async () => {
    expect(await call()).toEqual(S3);
    expect(cloudfront.getSignedUrl).not.toHaveBeenCalled();
    expect(storage.getPresignedUrl).toHaveBeenCalled();
  });

  it('does NOT match a non-allowlisted user', async () => {
    process.env.CLOUDFRONT_ALLOWLIST = '10,42';
    expect(await call({ id_user: 29 })).toEqual(S3);
    expect(cloudfront.getSignedUrl).not.toHaveBeenCalled();
  });

  it('falls back to S3 (and logs) when CloudFront signing returns null', async () => {
    config.getBoolean.mockResolvedValue(true);
    cloudfront.getSignedUrl.mockReturnValue(null);
    expect(await call()).toEqual(S3);
    expect(storage.getPresignedUrl).toHaveBeenCalled();
    expect(mockLoggerService.log).toHaveBeenCalled();
  });
});
