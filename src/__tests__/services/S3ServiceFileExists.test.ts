import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { S3Service } from '../../services/S3Service';
import { mockLoggerService } from '../setup';

/**
 * fileExists is tri-state, and LibraryService.processMovedFiles depends on the
 * distinction: only a definitive `false` from BOTH the source and target probe
 * lets it conclude a moved item's bytes are nowhere and leave source_path null.
 * A probe that merely could not determine the answer must come back as null, or
 * that path records "nothing exists" on an object it was simply unable to read.
 */
describe('S3Service.fileExists — tri-state', () => {
  let service: S3Service;
  let headObjectMock: jest.Mock;

  beforeEach(() => {
    service = new S3Service();
    headObjectMock = jest.fn();
    (service as any).client = { headObject: headObjectMock };
    (service as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  it('returns true when the object is there', async () => {
    headObjectMock.mockImplementation(async () => ({
      $metadata: { httpStatusCode: 200 },
    }));
    await expect(service.fileExists('prefix/root/a.m4b')).resolves.toBe(true);
  });

  it('returns false for a 404 — definitively absent', async () => {
    headObjectMock.mockImplementation(async () => {
      throw Object.assign(new Error('Not Found'), {
        $metadata: { httpStatusCode: 404 },
      });
    });
    await expect(service.fileExists('prefix/root/a.m4b')).resolves.toBe(false);
  });

  it('returns null for a 403 — denied is not the same as absent', async () => {
    headObjectMock.mockImplementation(async () => {
      throw Object.assign(new Error('Forbidden'), {
        $metadata: { httpStatusCode: 403 },
      });
    });
    await expect(service.fileExists('prefix/root/a.m4b')).resolves.toBeNull();
  });

  it('returns null for any other failure', async () => {
    headObjectMock.mockImplementation(async () => {
      throw Object.assign(new Error('boom'), {
        $metadata: { httpStatusCode: 500 },
      });
    });
    await expect(service.fileExists('prefix/root/a.m4b')).resolves.toBeNull();
  });

  it('does not log the storage prefix, which can be the account email', async () => {
    headObjectMock.mockImplementation(async () => {
      throw Object.assign(new Error('Forbidden'), {
        $metadata: { httpStatusCode: 403 },
      });
    });
    await service.fileExists('someone@example.com/root/a.m4b');

    const logged = JSON.stringify(mockLoggerService.log.mock.calls);
    expect(logged).not.toContain('someone@example.com');
    expect(logged).toContain('root/a.m4b');
  });
});
