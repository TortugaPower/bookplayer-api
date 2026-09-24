import { logger } from './LoggerService';
import { StorageService } from './StorageService';
import { LibraryDB } from './db/LibraryDB';
import { StoragePrefixService } from './StoragePrefixService';
import { LibraryItemDB, LibraryItemType, User } from '../types/user';
import {
  INVALID_PART_LIST,
  MAX_BOOK_PARTS,
  MAX_BOOK_SIZE,
  MAX_PART_SIZE,
  MAX_PART_URLS_PER_REQUEST,
  MAX_PARTS,
  MIN_PART_SIZE,
  MultipartPart,
  NO_SUCH_UPLOAD,
  PartUrl,
  StartUploadResult,
  UploadError,
  UploadErrorCode,
} from '../types/multipartUpload';

/**
 * Multipart uploads of a book's file to S3.
 *
 * Stateless by design: the client keeps the uploadId, every call re-derives the
 * key from the item's own row (so a client can only ever touch its own
 * objects), and S3's part list — not anything the client reports — decides
 * whether an upload is complete. `complete` is the only place a multipart
 * upload becomes `synced=true`; clients never confirm it themselves.
 *
 * Unexpected failures throw a plain Error (the controller answers 500 and the
 * client retries); outcomes the client must act on throw an UploadError with a
 * stable code.
 */
export class MultipartUploadService {
  private readonly _logger = logger;

  constructor(
    private _storage: StorageService = new StorageService(),
    private _libraryDB: LibraryDB = new LibraryDB(),
    private _prefix: StoragePrefixService = new StoragePrefixService(),
  ) {}

  async startUpload(
    user: User,
    params: { uuid: string; fileSize: number; partSize: number },
  ): Promise<StartUploadResult> {
    const { uuid, fileSize, partSize } = params;
    if (partSize < MIN_PART_SIZE || partSize > MAX_PART_SIZE) {
      throw new UploadError(
        UploadErrorCode.INVALID_REQUEST,
        422,
        `partSize must be between ${MIN_PART_SIZE} and ${MAX_PART_SIZE} bytes`,
      );
    }
    this.assertWithinBookLimit(fileSize);
    const partCount = Math.ceil(fileSize / partSize);
    if (partCount > MAX_PARTS) {
      throw new UploadError(
        UploadErrorCode.INVALID_REQUEST,
        422,
        `fileSize needs ${partCount} parts; the maximum is ${MAX_PARTS}`,
      );
    }

    const { item, key } = await this.resolveTarget(user, uuid);

    // The bytes may already be there — a retry after a lost `complete`
    // response, or a book another device finished uploading. Heal the row
    // instead of uploading it twice.
    const exists = await this._storage.fileExists({ key });
    if (exists === null) {
      throw new Error('Could not check the object in storage');
    }
    if (exists) {
      await this.markSynced(user, item, key);
      return { status: 'exists' };
    }

    const uploadId = await this._storage.createMultipartUpload(key);
    if (!uploadId) {
      throw new Error('Could not create the multipart upload');
    }
    return { status: 'started', uploadId, partSize, partCount };
  }

  async getPartUrls(
    user: User,
    params: { uuid: string; uploadId: string; partNumbers: number[] },
  ): Promise<PartUrl[]> {
    const { uuid, uploadId, partNumbers } = params;
    const unique = [...new Set(partNumbers)];
    if (unique.some((n) => n > MAX_BOOK_PARTS)) {
      throw new UploadError(
        UploadErrorCode.INVALID_REQUEST,
        422,
        `No book within the ${MAX_BOOK_SIZE}-byte limit needs a part above ${MAX_BOOK_PARTS}`,
      );
    }
    if (unique.length > MAX_PART_URLS_PER_REQUEST) {
      throw new UploadError(
        UploadErrorCode.INVALID_REQUEST,
        422,
        `At most ${MAX_PART_URLS_PER_REQUEST} part URLs per request`,
      );
    }

    const { key } = await this.resolveTarget(user, uuid);
    const urls: PartUrl[] = [];
    for (const partNumber of unique.sort((a, b) => a - b)) {
      const signed = await this._storage.getPresignedPartUrl(key, uploadId, partNumber);
      if (!signed) {
        throw new Error(`Could not sign part ${partNumber}`);
      }
      urls.push({ partNumber, url: signed.url, expiresAt: signed.expires_in });
    }
    return urls;
  }

  /** What S3 holds so far; the client resumes from this, never from memory. */
  async listParts(
    user: User,
    params: { uuid: string; uploadId: string },
  ): Promise<{ partNumber: number; size: number }[]> {
    const { key } = await this.resolveTarget(user, params.uuid);
    const parts = await this.fetchParts(key, params.uploadId);
    return parts.map(({ partNumber, size }) => ({ partNumber, size }));
  }

  async completeUpload(
    user: User,
    params: { uuid: string; uploadId: string; partCount: number; fileSize: number },
  ): Promise<void> {
    const { uuid, uploadId, partCount, fileSize } = params;
    const { item, key } = await this.resolveTarget(user, uuid);

    // start's size check can't bind complete: the server keeps no state, and
    // the parts must add up to exactly this fileSize, so capping it here means
    // nothing over the ceiling ever becomes an object. Free the parts now
    // rather than in 7 days.
    if (fileSize > MAX_BOOK_SIZE) {
      await this._storage.abortMultipartUpload(key, uploadId);
      this.assertWithinBookLimit(fileSize);
    }

    const listed = await this._storage.listParts(key, uploadId);
    if (listed === NO_SUCH_UPLOAD) {
      // Either a retried `complete` whose first attempt succeeded, or an
      // upload that was aborted. The object tells them apart.
      return this.confirmExistingOrFail(user, item, key);
    }
    if (listed === null) {
      throw new Error('Could not list the uploaded parts');
    }

    const parts = this.verifyParts(listed, partCount, fileSize);
    const completed = await this._storage.completeMultipartUpload(key, uploadId, parts);
    if (completed === NO_SUCH_UPLOAD) {
      // A concurrent `complete` for the same upload won the race.
      return this.confirmExistingOrFail(user, item, key);
    }
    if (completed === INVALID_PART_LIST) {
      throw new UploadError(
        UploadErrorCode.INVALID_PARTS,
        422,
        'Storage rejected the part list',
      );
    }
    if (completed === null) {
      throw new Error('Could not complete the multipart upload');
    }
    await this.markSynced(user, item, key);
  }

  /** Idempotent. A row that is already gone still answers success — S3's lifecycle rule reclaims the parts. */
  async abortUpload(
    user: User,
    params: { uuid: string; uploadId: string },
  ): Promise<void> {
    let key: string;
    try {
      ({ key } = await this.resolveTarget(user, params.uuid));
    } catch (err) {
      if (err instanceof UploadError && err.code === UploadErrorCode.ITEM_NOT_FOUND) return;
      throw err;
    }
    const aborted = await this._storage.abortMultipartUpload(key, params.uploadId);
    if (aborted === null) {
      throw new Error('Could not abort the multipart upload');
    }
  }

  private assertWithinBookLimit(fileSize: number): void {
    if (fileSize > MAX_BOOK_SIZE) {
      throw new UploadError(
        UploadErrorCode.INVALID_REQUEST,
        422,
        `fileSize exceeds the ${MAX_BOOK_SIZE}-byte limit for a book`,
      );
    }
  }

  /**
   * Every part 1…partCount must be present, nothing may sit above partCount,
   * every part except the last must share one size, and together they must be
   * exactly the file. Missing parts are the client's to re-send, not a reason
   * to start over, so they get their own code and the list. Anything else
   * means the client's count is wrong: completing would silently truncate the
   * file and still mark it synced. A count that is too low but whose parts all
   * exist is only caught by the size — hence `fileSize`.
   */
  private verifyParts(listed: MultipartPart[], partCount: number, fileSize: number): MultipartPart[] {
    const extra = listed.filter((part) => part.partNumber > partCount).map((part) => part.partNumber);
    if (extra.length) {
      throw new UploadError(
        UploadErrorCode.INVALID_PARTS,
        422,
        `Storage holds parts beyond partCount ${partCount}`,
        { extra },
      );
    }
    const byNumber = new Map(listed.map((part) => [part.partNumber, part]));
    const missing: number[] = [];
    for (let n = 1; n <= partCount; n++) {
      if (!byNumber.has(n)) missing.push(n);
    }
    if (missing.length) {
      throw new UploadError(
        UploadErrorCode.PARTS_MISSING,
        409,
        `${missing.length} of ${partCount} parts are not uploaded yet`,
        { missing },
      );
    }

    const parts = Array.from({ length: partCount }, (_, i) => byNumber.get(i + 1));
    const expectedSize = parts[0].size;
    const mismatched = parts.slice(0, -1).some((part) => part.size !== expectedSize);
    const lastTooBig = parts[parts.length - 1].size > expectedSize;
    if (mismatched || lastTooBig) {
      throw new UploadError(
        UploadErrorCode.INVALID_PARTS,
        422,
        'Uploaded parts do not share one part size',
      );
    }
    const uploaded = parts.reduce((total, part) => total + part.size, 0);
    if (uploaded !== fileSize || partCount !== Math.ceil(fileSize / expectedSize)) {
      throw new UploadError(
        UploadErrorCode.INVALID_PARTS,
        422,
        `Parts 1..${partCount} hold ${uploaded} bytes; the file is ${fileSize}`,
        { uploadedBytes: uploaded, fileSize },
      );
    }
    return parts;
  }

  private async fetchParts(key: string, uploadId: string): Promise<MultipartPart[]> {
    const listed = await this._storage.listParts(key, uploadId);
    if (listed === NO_SUCH_UPLOAD) {
      throw new UploadError(
        UploadErrorCode.UPLOAD_NOT_FOUND,
        409,
        'The upload no longer exists; start a new one',
      );
    }
    if (listed === null) {
      throw new Error('Could not list the uploaded parts');
    }
    return listed;
  }

  private async confirmExistingOrFail(user: User, item: LibraryItemDB, key: string): Promise<void> {
    const exists = await this._storage.fileExists({ key });
    if (exists === null) {
      throw new Error('Could not check the object in storage');
    }
    if (!exists) {
      throw new UploadError(
        UploadErrorCode.UPLOAD_NOT_FOUND,
        409,
        'The upload no longer exists; start a new one',
      );
    }
    await this.markSynced(user, item, key);
  }

  /**
   * Marks the row synced once its bytes are in S3. The row can vanish between
   * resolving it and marking it — a delete that ran while S3 was still
   * assembling the upload found nothing to abort or remove, so the completed
   * object would outlive its row forever (the lifecycle rule only reclaims
   * INCOMPLETE uploads). Remove it here instead.
   */
  private async markSynced(user: User, item: LibraryItemDB, key: string): Promise<void> {
    // Always written, even when the row already reads synced: a phantom row
    // (synced, no bytes) repaired by a re-upload still needs its media-server
    // links marked and the vanished-row check below.
    if (await this._libraryDB.markItemSynced(item.id_library_item)) return;

    const rows = await this._libraryDB.getLibraryByUuid(user.id_user, item.uuid);
    if (rows === null || rows.length) {
      // The row is still there (or we can't tell): a failed write. The bytes
      // are in S3, so a retried `start`/`complete` lands in the object-exists
      // branch and tries again.
      throw new Error('Could not mark the item synced');
    }
    this._logger.log(
      {
        origin: 'MultipartUploadService.markSynced',
        message: 'Row deleted while its upload completed; removing the orphaned object',
        data: { id_user: user.id_user, uuid: item.uuid },
      },
      'warn',
    );
    await this._storage.deleteFile({ sourceKey: key });
    throw new UploadError(
      UploadErrorCode.ITEM_NOT_FOUND,
      404,
      'No active book with that uuid',
    );
  }

  /** The caller's own active book with that uuid, and the S3 key its bytes live at. */
  private async resolveTarget(
    user: User,
    uuid: string,
  ): Promise<{ item: LibraryItemDB; key: string }> {
    const rows = await this._libraryDB.getLibraryByUuid(user.id_user, uuid);
    if (rows === null) {
      throw new Error('Could not load the library item');
    }
    const item = rows[0];
    if (!item || parseInt(`${item.type}`) !== parseInt(LibraryItemType.BOOK)) {
      throw new UploadError(
        UploadErrorCode.ITEM_NOT_FOUND,
        404,
        'No active book with that uuid',
      );
    }
    const storagePrefix = await this._prefix.getPrefix(user);
    return { item, key: `${storagePrefix}/${item.source_path || item.key}` };
  }
}
