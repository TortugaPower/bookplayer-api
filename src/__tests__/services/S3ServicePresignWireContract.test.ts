import { describe, it, expect, beforeEach } from '@jest/globals';
import { S3Client } from '@aws-sdk/client-s3';
import { S3Service } from '../../services/S3Service';
import { StorageAction } from '../../types/user';
import { mockLoggerService } from '../setup';

/**
 * The upload path rests on one property of the presigner: it hoists
 * `x-amz-storage-class` into the query string instead of `X-Amz-SignedHeaders`.
 * That is what lets the apps PUT the URL unchanged — no app release, and URLs
 * already handed out stay valid.
 *
 * The hoisting decision is per-header and not guaranteed: the presigner already
 * treats every `x-amz-server-side-encryption*` header as unhoistable. If an SDK
 * upgrade moved this header the same way, clients would have to send it to match
 * the signature, and every upload would fail with SignatureDoesNotMatch until
 * they did. S3ServiceStorageClass mocks the presigner, so it cannot see that.
 *
 * Signing is local — these tests make no network call, which is also the limit
 * of what they prove: that the SDK builds the URL this way, not that S3 acts on
 * it. The server half was verified live against the production bucket on
 * 2026-09-15 — a presigned PUT through S3Service landed as INTELLIGENT_TIERING
 * while a control PUT signed without the class landed as STANDARD, so S3 does
 * honour the hoisted query parameter and no bucket policy rejects it. That
 * needs a real PUT, so it is recorded here rather than asserted.
 */
describe('S3Service.getPresignedUrl — presigned PUT wire contract', () => {
  let service: S3Service;

  beforeEach(() => {
    process.env.S3_BUCKET = 'test-bucket';
    service = new S3Service();
    // A real client with static credentials: the presigner stays unmocked so
    // the assertions run against the URL the apps would actually receive.
    (service as any).clientObject = new S3Client({
      region: 'us-east-1',
      // SigV4 signs with any non-empty strings. Deliberately not AWS's
      // documented example access key: its prefix is what secret scanners match
      // on, and a hit here would cost someone a triage cycle for nothing.
      credentials: {
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key',
      },
    });
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('carries the storage class in the query, leaving the client to sign only host', async () => {
    const { url } = await service.getPresignedUrl(
      'prefix/root/a.m4b',
      StorageAction.PUT,
    );

    const q = new URL(url).searchParams;
    expect(q.get('x-amz-storage-class')).toBe('INTELLIGENT_TIERING');
    // The assertion that matters: if the storage class ever lands here instead,
    // clients must send the header to match the signature or every PUT 403s.
    expect(q.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('leaves a download URL free of any storage class', async () => {
    const { url } = await service.getPresignedUrl(
      'prefix/root/a.m4b',
      StorageAction.GET,
    );

    const q = new URL(url).searchParams;
    expect(q.get('x-amz-storage-class')).toBeNull();
    expect(q.get('X-Amz-SignedHeaders')).toBe('host');
  });
});
