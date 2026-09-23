// S3 multipart uploads for library files. The server is stateless: the client
// keeps the uploadId, the key is always derived from the item's row, and S3's
// part list is the source of truth for resuming and completing.

// S3's own limits: every part but the last must be at least 5 MiB, a part can
// be at most 5 GiB, and an upload holds at most 10,000 parts.
export const MIN_PART_SIZE = 5 * 1024 * 1024;
export const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024;
export const MAX_PARTS = 10000;
// S3's largest object. Checked at start: S3 would only refuse it at complete,
// after every part was already sent.
export const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * 1024 * 1024;
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
