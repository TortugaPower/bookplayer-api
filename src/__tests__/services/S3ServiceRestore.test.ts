import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { S3Service } from '../../services/S3Service';
import { mockLoggerService } from '../setup';

function s3Error(status: number, name = 'Error', message = 'boom') {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });
}

/** The two S3 calls the on-demand thaw relies on, at the wire: what is sent, how answers are classified. */
describe('S3Service — headObject / restoreObject', () => {
  let service: S3Service;
  let client: { headObject: jest.Mock<any>; restoreObject: jest.Mock<any> };

  beforeEach(() => {
    service = new S3Service();
    client = { headObject: jest.fn<any>(), restoreObject: jest.fn<any>() };
    (service as any).client = client;
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('headObject maps the Restore header to none / ongoing / ready', async () => {
    client.headObject.mockResolvedValueOnce({ StorageClass: 'DEEP_ARCHIVE', ContentLength: 5, $metadata: { httpStatusCode: 200 } });
    expect(await service.headObject('k')).toEqual({ storageClass: 'DEEP_ARCHIVE', restore: 'none', contentLength: 5 });

    client.headObject.mockResolvedValueOnce({ StorageClass: 'DEEP_ARCHIVE', Restore: 'ongoing-request="true"', $metadata: { httpStatusCode: 200 } });
    expect((await service.headObject('k') as any).restore).toBe('ongoing');

    client.headObject.mockResolvedValueOnce({
      StorageClass: 'DEEP_ARCHIVE',
      Restore: 'ongoing-request="false", expiry-date="Fri, 24 Oct 2026 00:00:00 GMT"',
      $metadata: { httpStatusCode: 200 },
    });
    expect((await service.headObject('k') as any).restore).toBe('ready');

    // STANDARD objects carry no StorageClass header at all.
    client.headObject.mockResolvedValueOnce({ ContentLength: 7, $metadata: { httpStatusCode: 200 } });
    expect(await service.headObject('k')).toEqual({ storageClass: undefined, restore: 'none', contentLength: 7 });
  });

  it('headObject: 404 is "missing", anything else is indeterminate (null) and logged at warn', async () => {
    client.headObject.mockRejectedValueOnce(s3Error(404, 'NotFound'));
    expect(await service.headObject('k')).toBe('missing');

    client.headObject.mockRejectedValueOnce(s3Error(403, 'AccessDenied'));
    expect(await service.headObject('k')).toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalledWith(expect.objectContaining({ origin: 'S3Service.headObject' }), 'warn');
  });

  it('restoreObject sends Days and the Glacier tier, and treats an in-flight restore as success', async () => {
    client.restoreObject.mockResolvedValueOnce({ $metadata: { httpStatusCode: 202 } });
    expect(await service.restoreObject('pfx/root/a.m4b', { days: 30, tier: 'Standard' })).toBe(true);
    expect(client.restoreObject).toHaveBeenCalledWith({
      Bucket: process.env.S3_BUCKET,
      Key: 'pfx/root/a.m4b',
      RestoreRequest: { Days: 30, GlacierJobParameters: { Tier: 'Standard' } },
    });

    client.restoreObject.mockRejectedValueOnce(s3Error(409, 'RestoreAlreadyInProgress'));
    expect(await service.restoreObject('k', { days: 30, tier: 'Standard' })).toBe(true);
  });

  it('restoreObject: any other failure is null and logged at warn', async () => {
    client.restoreObject.mockRejectedValueOnce(s3Error(403, 'InvalidObjectState'));
    expect(await service.restoreObject('k', { days: 30, tier: 'Standard' })).toBeNull();
    expect(mockLoggerService.log).toHaveBeenCalledWith(expect.objectContaining({ origin: 'S3Service.restoreObject' }), 'warn');
  });
});
