import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MultipartUploadService } from '../../services/MultipartUploadService';
import { LibraryItemType } from '../../types/user';
import {
  INVALID_PART_LIST,
  NO_SUCH_UPLOAD,
  UploadError,
  UploadErrorCode,
} from '../../types/multipartUpload';
import { mockLoggerService } from '../setup';

const MiB = 1024 * 1024;
const user = { id_user: 7, email: 'user@example.com', subscriptions: ['pro'] } as any;
const uuid = '11111111-1111-4111-8111-111111111111';

const book = (overrides: Record<string, unknown> = {}) => ({
  id_library_item: 42,
  uuid,
  key: 'Folder/Book.m4b',
  source_path: 'root/20260101000000_Book.m4b',
  type: LibraryItemType.BOOK,
  synced: false,
  ...overrides,
});

const part = (partNumber: number, size: number) => ({ partNumber, size, etag: `"e${partNumber}"` });

// Resolves to the UploadError a call rejects with, failing the test otherwise.
const uploadErrorOf = async (promise: Promise<unknown>): Promise<UploadError> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(UploadError);
    return err as UploadError;
  }
  throw new Error('expected an UploadError');
};

describe('MultipartUploadService', () => {
  let storage: Record<string, jest.Mock<(...args: any[]) => any>>;
  let libraryDB: Record<string, jest.Mock<(...args: any[]) => any>>;
  let service: MultipartUploadService;

  beforeEach(() => {
    storage = {
      fileExists: jest.fn(async () => false),
      createMultipartUpload: jest.fn(async () => 'up-1'),
      getPresignedPartUrl: jest.fn(async (_k: string, _u: string, n: number) => ({
        url: `https://s3/part-${n}`,
        expires_in: 1_900_000_000,
      })),
      listParts: jest.fn(),
      completeMultipartUpload: jest.fn(async () => true),
      abortMultipartUpload: jest.fn(async () => true),
      deleteFile: jest.fn(async () => true),
    };
    libraryDB = {
      getLibraryByUuid: jest.fn(async () => [book()]),
      markItemSynced: jest.fn(async () => true),
    };
    const prefix = { getPrefix: jest.fn(async () => 'prefix') };
    service = new MultipartUploadService(storage as any, libraryDB as any, prefix as any);
    (service as any)._logger = mockLoggerService;
  });

  describe('startUpload', () => {
    it('opens an upload at the key derived from the row, never from the client', async () => {
      const result = await service.startUpload(user, { uuid, fileSize: 130 * MiB, partSize: 64 * MiB });

      expect(result).toEqual({ status: 'started', uploadId: 'up-1', partSize: 64 * MiB, partCount: 3 });
      expect(storage.createMultipartUpload).toHaveBeenCalledWith('prefix/root/20260101000000_Book.m4b');
    });

    it('falls back to the key for legacy rows without a source path', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValueOnce([book({ source_path: null })]);

      await service.startUpload(user, { uuid, fileSize: MiB, partSize: 64 * MiB });

      expect(storage.createMultipartUpload).toHaveBeenCalledWith('prefix/Folder/Book.m4b');
    });

    it('heals the row instead of uploading bytes that are already there', async () => {
      storage.fileExists.mockResolvedValueOnce(true);

      await expect(
        service.startUpload(user, { uuid, fileSize: MiB, partSize: 64 * MiB }),
      ).resolves.toEqual({ status: 'exists' });
      expect(libraryDB.markItemSynced).toHaveBeenCalledWith(42);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('fails retryably when S3 cannot say whether the object exists', async () => {
      storage.fileExists.mockResolvedValueOnce(null);

      await expect(
        service.startUpload(user, { uuid, fileSize: MiB, partSize: 64 * MiB }),
      ).rejects.not.toBeInstanceOf(UploadError);
    });

    it.each([
      ['a part under S3 minimum', { fileSize: 100 * MiB, partSize: 4 * MiB }],
      ['a part over S3 maximum', { fileSize: 100 * MiB, partSize: 5 * 1024 * MiB + 1 }],
      ['more than 10,000 parts', { fileSize: 10_001 * 5 * MiB, partSize: 5 * MiB }],
      ['an object over 5 TiB', { fileSize: 5 * 1024 * 1024 * MiB + 1, partSize: 5 * 1024 * MiB }],
    ])('rejects %s as a request that can never work, before touching S3', async (_label, sizes) => {
      const err = await uploadErrorOf(service.startUpload(user, { uuid, ...sizes }));

      // Not invalid_parts: that one tells the client to restart, which would fail the same way.
      expect(err.code).toBe(UploadErrorCode.INVALID_REQUEST);
      expect(err.statusCode).toBe(422);
      expect(libraryDB.getLibraryByUuid).not.toHaveBeenCalled();
    });

    it.each([
      ['a file smaller than one part', MiB, 64 * MiB, 1],
      ['a file exactly one part long', 64 * MiB, 64 * MiB, 1],
      ['exactly 10,000 parts', 10_000 * 5 * MiB, 5 * MiB, 10_000],
    ])('counts parts for %s', async (_label, fileSize, partSize, partCount) => {
      await expect(service.startUpload(user, { uuid, fileSize, partSize })).resolves.toMatchObject({
        status: 'started',
        partCount,
      });
    });

    it('looks the row up for the caller only, and builds the key from the caller prefix', async () => {
      await service.startUpload(user, { uuid, fileSize: MiB, partSize: 64 * MiB });

      // The only thing between a client-supplied uuid and another user's object.
      expect(libraryDB.getLibraryByUuid).toHaveBeenCalledWith(user.id_user, uuid);
      expect((service as any)._prefix.getPrefix).toHaveBeenCalledWith(user);
    });

    it.each([
      ['no row', []],
      ['a folder', [book({ type: LibraryItemType.FOLDER })]],
    ])('answers item_not_found for %s', async (_label, rows) => {
      libraryDB.getLibraryByUuid.mockResolvedValueOnce(rows);

      const err = await uploadErrorOf(service.startUpload(user, { uuid, fileSize: MiB, partSize: 64 * MiB }));

      expect(err.code).toBe(UploadErrorCode.ITEM_NOT_FOUND);
      expect(err.statusCode).toBe(404);
    });

    it('fails retryably, not as item_not_found, when the row lookup itself failed', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValueOnce(null);

      await expect(
        service.startUpload(user, { uuid, fileSize: MiB, partSize: 64 * MiB }),
      ).rejects.not.toBeInstanceOf(UploadError);
    });
  });

  describe('getPartUrls', () => {
    it('answers more than 32 distinct parts with invalid_request, counting after de-duplication', async () => {
      const many = Array.from({ length: 33 }, (_, i) => i + 1);

      const err = await uploadErrorOf(service.getPartUrls(user, { uuid, uploadId: 'up-1', partNumbers: many }));
      expect(err.code).toBe(UploadErrorCode.INVALID_REQUEST);

      const repeated = [...Array(40).fill(1), 2];
      await expect(
        service.getPartUrls(user, { uuid, uploadId: 'up-1', partNumbers: repeated }),
      ).resolves.toHaveLength(2);
    });

    it('signs each requested part once, in order', async () => {
      const urls = await service.getPartUrls(user, { uuid, uploadId: 'up-1', partNumbers: [3, 1, 3] });

      expect(urls.map((u) => u.partNumber)).toEqual([1, 3]);
      expect(urls[0]).toEqual({ partNumber: 1, url: 'https://s3/part-1', expiresAt: 1_900_000_000 });
    });
  });

  describe('listParts', () => {
    it('tells the client to start over when the upload is gone', async () => {
      storage.listParts.mockResolvedValueOnce(NO_SUCH_UPLOAD);

      const err = await uploadErrorOf(service.listParts(user, { uuid, uploadId: 'up-1' }));

      expect(err.code).toBe(UploadErrorCode.UPLOAD_NOT_FOUND);
    });

    it('returns numbers and sizes, never the ETags', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 10)]);

      await expect(service.listParts(user, { uuid, uploadId: 'up-1' })).resolves.toEqual([
        { partNumber: 1, size: 10 },
      ]);
    });
  });

  describe('completeUpload', () => {
    // The two part layouts the tests use: one 7-byte part, or 64 + 64 + 7.
    const complete = (partCount: number, fileSize = partCount === 1 ? 7 : 135) =>
      service.completeUpload(user, { uuid, uploadId: 'up-1', partCount, fileSize });

    it('completes from S3 own part list and only then marks the row synced', async () => {
      storage.listParts.mockResolvedValueOnce([part(2, 64), part(1, 64), part(3, 7)]);

      await complete(3);

      const [, , parts] = storage.completeMultipartUpload.mock.calls[0];
      expect(parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([1, 2, 3]);
      expect(libraryDB.markItemSynced).toHaveBeenCalledWith(42);
    });

    it('refuses to complete when S3 holds parts beyond the count, instead of truncating the file', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 64), part(2, 64), part(3, 7)]);

      const err = await uploadErrorOf(complete(2));

      expect(err.code).toBe(UploadErrorCode.INVALID_PARTS);
      expect(err.details).toEqual({ extra: [3] });
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(libraryDB.markItemSynced).not.toHaveBeenCalled();
    });

    it('refuses a count that is too low when every counted part exists: only the size shows the truncation', async () => {
      // A client that rounds fileSize/partSize down sends 2 for a 3-part book
      // and never uploads part 3; S3 holds exactly 1..2, so no part is "extra".
      storage.listParts.mockResolvedValueOnce([part(1, 64), part(2, 64)]);

      const err = await uploadErrorOf(complete(2, 135));

      expect(err.code).toBe(UploadErrorCode.INVALID_PARTS);
      expect(err.details).toEqual({ uploadedBytes: 128, fileSize: 135 });
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(libraryDB.markItemSynced).not.toHaveBeenCalled();
    });

    it('refuses parts that do not add up to the file', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 64), part(2, 64), part(3, 7)]);

      const err = await uploadErrorOf(complete(3, 200));

      expect(err.code).toBe(UploadErrorCode.INVALID_PARTS);
    });

    it('refuses an empty trailing part the size alone would not catch', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 64), part(2, 0)]);

      const err = await uploadErrorOf(complete(2, 64));

      expect(err.code).toBe(UploadErrorCode.INVALID_PARTS);
    });

    it('lists the missing parts so the client re-sends only those', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 64), part(3, 7)]);

      const err = await uploadErrorOf(complete(4));

      expect(err.code).toBe(UploadErrorCode.PARTS_MISSING);
      expect(err.statusCode).toBe(409);
      expect(err.details).toEqual({ missing: [2, 4] });
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it.each([
      ['a middle part of a different size', [part(1, 64), part(2, 60), part(3, 7)]],
      ['a last part larger than the others', [part(1, 64), part(2, 70)]],
    ])('rejects %s as invalid parts', async (_label, listed) => {
      storage.listParts.mockResolvedValueOnce(listed);

      const err = await uploadErrorOf(complete(listed.length));

      expect(err.code).toBe(UploadErrorCode.INVALID_PARTS);
      expect(libraryDB.markItemSynced).not.toHaveBeenCalled();
    });

    it('is safe to retry after a lost response: gone upload plus existing object is success', async () => {
      storage.listParts.mockResolvedValueOnce(NO_SUCH_UPLOAD);
      storage.fileExists.mockResolvedValueOnce(true);

      await expect(complete(3)).resolves.toBeUndefined();
      expect(libraryDB.markItemSynced).toHaveBeenCalledWith(42);
    });

    it('still confirms a row already marked synced: a repaired phantom needs its links marked', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValueOnce([book({ synced: true })]);
      storage.listParts.mockResolvedValueOnce([part(1, 7)]);

      await complete(1);

      expect(libraryDB.markItemSynced).toHaveBeenCalledWith(42);
    });

    it('asks for a fresh start when the upload is gone and nothing landed', async () => {
      storage.listParts.mockResolvedValueOnce(NO_SUCH_UPLOAD);
      storage.fileExists.mockResolvedValueOnce(false);

      const err = await uploadErrorOf(complete(3));

      expect(err.code).toBe(UploadErrorCode.UPLOAD_NOT_FOUND);
      expect(libraryDB.markItemSynced).not.toHaveBeenCalled();
    });

    it('confirms when a concurrent complete won the race', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 7)]);
      storage.completeMultipartUpload.mockResolvedValueOnce(NO_SUCH_UPLOAD);
      storage.fileExists.mockResolvedValueOnce(true);

      await complete(1);

      expect(libraryDB.markItemSynced).toHaveBeenCalledWith(42);
    });

    it('maps an S3-rejected part list to invalid parts', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 7)]);
      storage.completeMultipartUpload.mockResolvedValueOnce(INVALID_PART_LIST);

      const err = await uploadErrorOf(complete(1));

      expect(err.code).toBe(UploadErrorCode.INVALID_PARTS);
    });

    it('fails retryably when the bytes landed but the row could not be marked', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 7)]);
      libraryDB.markItemSynced.mockResolvedValueOnce(false);

      await expect(complete(1)).rejects.not.toBeInstanceOf(UploadError);
      // The row is still there, so its bytes must be kept for the retry.
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('removes the object when the book was deleted while S3 assembled it', async () => {
      // A delete that ran mid-complete found nothing to abort or remove; the
      // lifecycle rule never touches a completed object, so this is the only cleanup.
      storage.listParts.mockResolvedValueOnce([part(1, 7)]);
      libraryDB.markItemSynced.mockResolvedValueOnce(false);
      libraryDB.getLibraryByUuid
        .mockResolvedValueOnce([book({ uuid })])
        .mockResolvedValueOnce([]);

      const err = await uploadErrorOf(complete(1));

      expect(err.code).toBe(UploadErrorCode.ITEM_NOT_FOUND);
      // Re-read for this caller and this book only, before deleting anything.
      expect(libraryDB.getLibraryByUuid).toHaveBeenLastCalledWith(user.id_user, uuid);
      expect(storage.deleteFile).toHaveBeenCalledWith({ sourceKey: 'prefix/root/20260101000000_Book.m4b' });
    });

    it('keeps the object when it cannot tell whether the row still exists', async () => {
      storage.listParts.mockResolvedValueOnce([part(1, 7)]);
      libraryDB.markItemSynced.mockResolvedValueOnce(false);
      libraryDB.getLibraryByUuid.mockResolvedValueOnce([book({ uuid })]).mockResolvedValueOnce(null);

      await expect(complete(1)).rejects.not.toBeInstanceOf(UploadError);
      expect(libraryDB.getLibraryByUuid).toHaveBeenLastCalledWith(user.id_user, uuid);
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('abortUpload', () => {
    it('succeeds for a row that is already gone', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValueOnce([]);

      await expect(service.abortUpload(user, { uuid, uploadId: 'up-1' })).resolves.toBeUndefined();
      expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('aborts at the row key', async () => {
      await service.abortUpload(user, { uuid, uploadId: 'up-1' });

      expect(storage.abortMultipartUpload).toHaveBeenCalledWith('prefix/root/20260101000000_Book.m4b', 'up-1');
    });
  });
});
