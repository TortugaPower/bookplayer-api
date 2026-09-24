// S3 multipart uploads for library files. The server is stateless: the client
// keeps the uploadId, the key is always derived from the item's row, and S3's
// part list is the source of truth for resuming and completing.

// S3's own limits: every part but the last must be at least 5 MiB, a part can
// be at most 5 GiB, and an upload holds at most 10,000 parts.
export const MIN_PART_SIZE = 5 * 1024 * 1024;
export const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024;
export const MAX_PARTS = 10000;
// The largest book we store — a product ceiling, far below S3's 5 TiB object
// limit. The longest audiobook known (Wind and Truth, 62 h 48 min) is ~1.7 GiB
// at 64 kbps and ~6.7 GiB even at 256 kbps. Enforced at start (before an
// upload exists), at complete (the server is stateless, so it can't trust
// start's number), and on part numbers.
export const MAX_BOOK_SIZE = 10 * 1024 * 1024 * 1024;
// No book within the ceiling needs a part number above this: MAX_BOOK_SIZE
// split into the smallest parts S3 allows.
export const MAX_BOOK_PARTS = Math.ceil(MAX_BOOK_SIZE / MIN_PART_SIZE);
// Bounds one presign request; the client asks per window top-up.
export const MAX_PART_URLS_PER_REQUEST = 32;

// Machine-readable codes the clients branch on — keep them stable.
export enum UploadErrorCode {
  // The request's sizes or part numbers can never work; retrying it unchanged fails the same way.
  INVALID_REQUEST = 'invalid_request',
  ITEM_NOT_FOUND = 'item_not_found',
  UPLOAD_NOT_FOUND = 'upload_not_found',
  PARTS_MISSING = 'parts_missing',
  INVALID_PARTS = 'invalid_parts',
}

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface MultipartUploadRef {
  key: string;
  uploadId: string;
}

export interface MultipartPart {
  partNumber: number;
  size: number;
  etag: string;
}

// Outcomes S3 reports as errors but callers must branch on, kept apart from
// `null` (an unexpected failure, already logged).
export const NO_SUCH_UPLOAD = 'no_such_upload' as const;
export const INVALID_PART_LIST = 'invalid_part_list' as const;

export type StartUploadResult =
  | { status: 'exists' }
  | { status: 'started'; uploadId: string; partSize: number; partCount: number };

export interface PartUrl {
  partNumber: number;
  url: string;
  expiresAt: number;
}
