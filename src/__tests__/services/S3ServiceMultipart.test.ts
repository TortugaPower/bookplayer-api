import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { S3Service } from '../../services/S3Service';
import { INVALID_PART_LIST, NO_SUCH_UPLOAD } from '../../types/multipartUpload';
import { mockLoggerService } from '../setup';

const s3Error = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe('S3Service — multipart uploads', () => {
  let service: S3Service;
  let sendMock: jest.Mock<(command: any) => Promise<any>>;

  beforeEach(() => {
    process.env.S3_BUCKET = 'test-bucket';
    service = new S3Service();
    sendMock = jest.fn(async () => ({}));
    (service as any).clientObject = { send: sendMock };
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const sent = (i: number) => sendMock.mock.calls[i][0];

  it('opens an upload straight into Intelligent-Tiering, like the single-PUT path', async () => {
    sendMock.mockResolvedValueOnce({ UploadId: 'up-1' });

    await expect(service.createMultipartUpload('prefix/root/a.m4b')).resolves.toBe('up-1');
    expect(sent(0).input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'prefix/root/a.m4b',
      StorageClass: 'INTELLIGENT_TIERING',
    });
  });

  it('lists every part across pages, ascending', async () => {
    sendMock
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 2, Size: 10, ETag: '"b"' }],
        IsTruncated: true,
        NextPartNumberMarker: '2',
      })
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 1, Size: 10, ETag: '"a"' }],
        IsTruncated: false,
      });

    const parts = await service.listParts('k', 'up-1');

    expect(parts).toEqual([
      { partNumber: 1, size: 10, etag: '"a"' },
      { partNumber: 2, size: 10, etag: '"b"' },
    ]);
    expect(sent(1).input.PartNumberMarker).toBe('2');
  });

  it('reports a vanished upload instead of an error when listing', async () => {
    sendMock.mockRejectedValueOnce(s3Error('NoSuchUpload', 404));

    await expect(service.listParts('k', 'up-1')).resolves.toBe(NO_SUCH_UPLOAD);
    expect(mockLoggerService.log).not.toHaveBeenCalled();
  });

  it('treats a missing bucket as a failure, not a vanished upload', async () => {
    // Also a 404: reading it as NoSuchUpload would send every client into a
    // restart instead of surfacing the misconfiguration.
    sendMock.mockRejectedValueOnce(s3Error('NoSuchBucket', 404));

    await expect(service.listParts('k', 'up-1')).resolves.toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalledTimes(1);
  });

  it('reads a bare 404 with no error name as a vanished upload', async () => {
    // A plain rejection with no `name` at all (an Error always carries one).
    sendMock.mockRejectedValueOnce({ message: 'gone', $metadata: { httpStatusCode: 404 } });

    await expect(service.listParts('k', 'up-1')).resolves.toBe(NO_SUCH_UPLOAD);
  });

  it('completes with the parts in the order given', async () => {
    await expect(
      service.completeMultipartUpload('k', 'up-1', [
        { partNumber: 1, size: 10, etag: '"a"' },
        { partNumber: 2, size: 5, etag: '"b"' },
      ]),
    ).resolves.toBe(true);
    expect(sent(0).input.MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' },
      { PartNumber: 2, ETag: '"b"' },
    ]);
  });

  it.each(['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'])(
    'maps %s on complete to an invalid part list',
    async (name) => {
      sendMock.mockRejectedValueOnce(s3Error(name, 400));
      await expect(service.completeMultipartUpload('k', 'up-1', [])).resolves.toBe(INVALID_PART_LIST);
    },
  );

  it('maps NoSuchUpload on complete, and logs anything else as a failure', async () => {
    sendMock.mockRejectedValueOnce(s3Error('NoSuchUpload', 404));
    await expect(service.completeMultipartUpload('k', 'up-1', [])).resolves.toBe(NO_SUCH_UPLOAD);

    sendMock.mockRejectedValueOnce(s3Error('InternalError', 500));
    await expect(service.completeMultipartUpload('k', 'up-1', [])).resolves.toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalledTimes(1);
  });

  it('treats aborting an upload that is already gone as success', async () => {
    sendMock.mockRejectedValueOnce(s3Error('NoSuchUpload', 404));
    await expect(service.abortMultipartUpload('k', 'up-1')).resolves.toBe(true);
  });

  it('lists every upload under a prefix across pages, with its key', async () => {
    sendMock
      .mockResolvedValueOnce({
        Uploads: [
          { Key: 'p/root/a.m4b', UploadId: 'up-1' },
          { Key: 'p/root/b.m4b', UploadId: 'up-2' },
        ],
        IsTruncated: true,
        NextKeyMarker: 'p/root/b.m4b',
        NextUploadIdMarker: 'up-2',
      })
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'p/root/c.m4b', UploadId: 'up-3' }],
        IsTruncated: false,
      });

    await expect(service.listMultipartUploads('p/')).resolves.toEqual([
      { key: 'p/root/a.m4b', uploadId: 'up-1' },
      { key: 'p/root/b.m4b', uploadId: 'up-2' },
      { key: 'p/root/c.m4b', uploadId: 'up-3' },
    ]);
    expect(sent(0).input.Prefix).toBe('p/');
    expect(sent(1).input).toMatchObject({ KeyMarker: 'p/root/b.m4b', UploadIdMarker: 'up-2' });
  });
});

describe('S3Service.fileExists — what a HEAD answer means', () => {
  let service: S3Service;
  let headMock: jest.Mock<(input: any) => Promise<any>>;

  beforeEach(() => {
    service = new S3Service();
    headMock = jest.fn(async () => ({ $metadata: { httpStatusCode: 200 } }));
    (service as any).client = { headObject: headMock };
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('reads 404 as a missing object', async () => {
    headMock.mockRejectedValueOnce(s3Error('NotFound', 404));
    await expect(service.fileExists('k')).resolves.toBe(false);
  });

  it('reads 403 as unknown, not missing: the role can list the bucket, so a denial is real', async () => {
    headMock.mockRejectedValueOnce(s3Error('Forbidden', 403));
    await expect(service.fileExists('k')).resolves.toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalledTimes(1);
  });
});

/**
 * Part URLs are signed locally, so these run the real presigner (as the
 * single-PUT wire contract test does) and assert what the client receives.
 */
describe('S3Service.getPresignedPartUrl — wire contract', () => {
  let service: S3Service;
  const saved: Record<string, string | undefined> = {};
  const ENV = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_REGION', 'NODE_ENV'];

  beforeEach(() => {
    for (const name of ENV) saved[name] = process.env[name];
    // The service's own part-signing client is under test, so it must build
    // its credentials from the environment (dummy values; signing is local).
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key-id';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = 'test-bucket';
    service = new S3Service();
    (service as any)._logger = mockLoggerService;
  });

  afterEach(() => {
    delete process.env.UPLOAD_PART_URL_TTL_SECONDS;
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('carries no checksum parameters: the default client would sign one for an empty body', async () => {
    // The default S3Client (SDK 3.729+) adds both; the real part bytes could
    // only mismatch them against an upload created with no checksum algorithm.
    const { url } = await service.getPresignedPartUrl('prefix/root/a.m4b', 'up-1', 1);

    const names = [...new URL(url).searchParams.keys()];
    expect(names.filter((n) => /checksum/i.test(n))).toEqual([]);
  });

  it('ignores the TTL override in production', async () => {
    process.env.UPLOAD_PART_URL_TTL_SECONDS = '60';
    process.env.NODE_ENV = 'production';

    const { url } = await service.getPresignedPartUrl('k', 'up-1', 1);

    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe(String(3600 * 24 * 7));
  });

  it('signs a PUT for that part of that upload, needing only the host header', async () => {
    const { url } = await service.getPresignedPartUrl('prefix/root/a.m4b', 'up-1', 3);

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/prefix/root/a.m4b');
    expect(parsed.searchParams.get('uploadId')).toBe('up-1');
    expect(parsed.searchParams.get('partNumber')).toBe('3');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(3600 * 24 * 7));
  });

  it('honours the development TTL override, capped at the SigV4 maximum', async () => {
    process.env.UPLOAD_PART_URL_TTL_SECONDS = '60';
    let { url } = await service.getPresignedPartUrl('k', 'up-1', 1);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');

    process.env.UPLOAD_PART_URL_TTL_SECONDS = String(3600 * 24 * 30);
    ({ url } = await service.getPresignedPartUrl('k', 'up-1', 1));
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe(String(3600 * 24 * 7));
  });
});

/**
 * Multipart made books over 5 GiB possible, and a single CopyObject can't copy
 * them into the `deleted_` support prefix. The delete must still happen.
 */
describe('S3Service.deleteFile — books beyond the 5 GiB copy limit', () => {
  let service: S3Service;
  let sendMock: jest.Mock<(command: any) => Promise<any>>;
  let headMock: jest.Mock<(input: any) => Promise<any>>;
  const GiB = 1024 * 1024 * 1024;

  beforeEach(() => {
    process.env.S3_BUCKET = 'test-bucket';
    service = new S3Service();
    sendMock = jest.fn(async () => ({}));
    headMock = jest.fn(async () => ({ ContentLength: 6 * GiB }));
    (service as any).clientObject = { send: sendMock };
    (service as any).client = { headObject: headMock };
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const commandNames = () => sendMock.mock.calls.map((call) => call[0].constructor.name);

  it('deletes a book too large to copy, without the support copy', async () => {
    sendMock.mockRejectedValueOnce(s3Error('InvalidRequest', 400));

    await expect(service.deleteFile('p/root/big.m4b')).resolves.toBe(true);

    expect(commandNames()).toEqual(['CopyObjectCommand', 'DeleteObjectCommand']);
    expect(sendMock.mock.calls[1][0].input.Key).toBe('p/root/big.m4b');
  });

  it('keeps the old behaviour for any other copy failure: nothing is deleted without its copy', async () => {
    sendMock.mockRejectedValueOnce(s3Error('InternalError', 500));
    headMock.mockResolvedValueOnce({ ContentLength: 3 * GiB });

    await expect(service.deleteFile('p/root/book.m4b')).resolves.toBeNull();

    expect(commandNames()).toEqual(['CopyObjectCommand']);
  });

  it('keeps the old behaviour when it cannot tell the size', async () => {
    sendMock.mockRejectedValueOnce(s3Error('InvalidRequest', 400));
    headMock.mockRejectedValueOnce(s3Error('NotFound', 404));

    await expect(service.deleteFile('p/root/gone.m4b')).resolves.toBeNull();

    expect(commandNames()).toEqual(['CopyObjectCommand']);
  });

  it('never looks at the size when the copy succeeds', async () => {
    await expect(service.deleteFile('p/root/book.m4b')).resolves.toBe(true);

    expect(headMock).not.toHaveBeenCalled();
    expect(commandNames()).toEqual(['CopyObjectCommand', 'DeleteObjectCommand']);
  });
});
