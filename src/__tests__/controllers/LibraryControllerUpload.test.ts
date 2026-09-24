import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryController } from '../../controllers/LibraryController';
import { UploadError, UploadErrorCode } from '../../types/multipartUpload';
import { mockLoggerService } from '../setup';

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const uuid = '11111111-1111-4111-8111-111111111111';

// Clients branch on `code`, so the mapping from UploadError to the wire is
// part of the contract; anything unexpected must read as retryable (5xx).
describe('LibraryController — multipart upload error mapping', () => {
  let uploads: Record<string, jest.Mock<(...args: any[]) => Promise<any>>>;
  let controller: LibraryController;

  beforeEach(() => {
    uploads = {
      startUpload: jest.fn(),
      getPartUrls: jest.fn(),
      listParts: jest.fn(),
      completeUpload: jest.fn(),
      abortUpload: jest.fn(),
    };
    controller = new LibraryController({} as any, {} as any, uploads as any);
    (controller as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const request = (body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) =>
    ({ body, query, user: { id_user: 1, email: 'user@example.com' } }) as any;

  it('sends the code, status and details of an UploadError', async () => {
    uploads.completeUpload.mockRejectedValue(
      new UploadError(UploadErrorCode.PARTS_MISSING, 409, '1 of 3 parts are not uploaded yet', {
        missing: [2],
      }),
    );
    const res = makeRes();

    await controller.completeUpload(request({ uuid, uploadId: 'up-1', partCount: 3, fileSize: 135 }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: '1 of 3 parts are not uploaded yet',
      code: 'parts_missing',
      missing: [2],
    });
  });

  it('answers a generic 500 for anything unexpected', async () => {
    uploads.startUpload.mockRejectedValue(new Error('S3 is down'));
    const res = makeRes();

    await controller.startUpload(request({ uuid, fileSize: 1, partSize: 1 }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
  });

  it('confirms a completed upload as synced', async () => {
    uploads.completeUpload.mockResolvedValue(undefined);
    const res = makeRes();

    await controller.completeUpload(request({ uuid, uploadId: 'up-1', partCount: 1, fileSize: 7 }), res);

    expect(res.json).toHaveBeenCalledWith({ synced: true });
  });

  it('validates the list-parts query before calling the service', async () => {
    const res = makeRes();

    await controller.listUploadParts(request({}, { uuid: 'not-a-uuid', uploadId: 'up-1' }), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(uploads.listParts).not.toHaveBeenCalled();
  });

  it('wraps signed part URLs in a parts field', async () => {
    uploads.getPartUrls.mockResolvedValue([{ partNumber: 1, url: 'https://s3/1', expiresAt: 1 }]);
    const res = makeRes();

    await controller.getUploadPartUrls(request({ uuid, uploadId: 'up-1', partNumbers: [1] }), res);

    expect(res.json).toHaveBeenCalledWith({ parts: [{ partNumber: 1, url: 'https://s3/1', expiresAt: 1 }] });
  });
});

describe('LibraryController.getLibraryObject — server-owned fields', () => {
  it('never lets a client write source_path, which decides the S3 object a row points at', async () => {
    const libraryService = { updateObject: jest.fn(async () => true) };
    const controller = new LibraryController(libraryService as any, {} as any, {} as any);
    (controller as any)._logger = mockLoggerService;
    const res = makeRes();

    await controller.getLibraryObject(
      {
        body: {
          relativePath: 'Book.m4b',
          uuid,
          title: 'Renamed',
          source_path: 'root/someone-elses-book.m4b',
          sourcePath: 'root/also-not-yours.m4b',
        },
        user: { id_user: 1, email: 'user@example.com' },
      } as any,
      res,
    );

    expect(libraryService.updateObject).toHaveBeenCalledWith(
      expect.anything(),
      'Book.m4b',
      { title: 'Renamed' },
      uuid,
    );
  });

  it('writes nothing when source_path was the only field sent', async () => {
    const libraryService = { updateObject: jest.fn(async () => true) };
    const controller = new LibraryController(libraryService as any, {} as any, {} as any);
    (controller as any)._logger = mockLoggerService;

    await controller.getLibraryObject(
      { body: { relativePath: 'Book.m4b', uuid, source_path: 'root/x.m4b' }, user: { id_user: 1 } } as any,
      makeRes(),
    );

    expect(libraryService.updateObject).not.toHaveBeenCalled();
  });
});
