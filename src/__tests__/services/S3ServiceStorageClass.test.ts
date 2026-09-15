import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGetSignedUrl = jest.fn(async () => 'https://signed.example/put');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => (mockGetSignedUrl as any)(...args),
}));

import { S3Service } from '../../services/S3Service';
import { StorageAction } from '../../types/user';
import { mockLoggerService } from '../setup';

/**
 * Nothing in the codebase reads an object's storage class back, so a refactor
 * that drops StorageClass from these commands would silently return every
 * upload to STANDARD with no visible symptom. These assertions are the only
 * thing standing between that regression and production.
 */
describe('S3Service — storage class on writes', () => {
  let service: S3Service;
  let sendMock: jest.Mock;

  beforeEach(() => {
    process.env.S3_BUCKET = 'test-bucket';
    service = new S3Service();
    sendMock = jest.fn(async () => ({}));
    (service as any).clientObject = { send: sendMock };
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
    (mockGetSignedUrl as any).mockClear();
  });

  const signedCommand = () => (mockGetSignedUrl as any).mock.calls[0][1];
  const sentCommand = (i: number) => (sendMock as any).mock.calls[i][0];

  it('signs an upload URL that writes into Intelligent-Tiering', async () => {
    await service.getPresignedUrl('prefix/root/a.m4b', StorageAction.PUT);

    expect(signedCommand().input.StorageClass).toBe('INTELLIGENT_TIERING');
  });

  it('leaves the storage class off a download URL', async () => {
    // A GET carries no storage class; setting one would change the signature
    // for every client that only ever reads.
    await service.getPresignedUrl('prefix/root/a.m4b', StorageAction.GET);

    expect(signedCommand().input.StorageClass).toBeUndefined();
  });

  it('keeps a moved object in Intelligent-Tiering', async () => {
    // A copy does not inherit the source object's class, so the move would
    // otherwise demote the object to STANDARD.
    await service.moveFile('prefix/root/a.m4b', 'prefix/root/b.m4b');

    const copy = sentCommand(0);
    expect(copy.input.Key).toBe('prefix/root/b.m4b');
    expect(copy.input.StorageClass).toBe('INTELLIGENT_TIERING');
  });

  it('leaves the support copy of a deleted object in STANDARD', async () => {
    // `remove-deleted-items` expires this prefix within days, well before
    // Intelligent-Tiering earns back its monitoring charge.
    await service.deleteFile('prefix/root/a.m4b');

    const copy = sentCommand(0);
    expect(copy.input.Key).toBe('deleted_prefix/root/a.m4b');
    expect(copy.input.StorageClass).toBeUndefined();
  });
});
