import { z } from 'zod';
import {
  MAX_BOOK_PARTS,
  MAX_BOOK_SIZE,
  MAX_PART_SIZE,
  MAX_PART_URLS_PER_REQUEST,
  MIN_PART_SIZE,
} from '../types/multipartUpload';

// Request-body schemas for /v1/library/upload/*. Every limit on what a client
// may ask for lives here; MultipartUploadService only checks the request
// against S3 and the database.

const uuid = z
  .string({ required_error: 'A valid item uuid is required' })
  .uuid('A valid item uuid is required');
const uploadId = z
  .string({ required_error: 'uploadId is required' })
  .min(1, 'uploadId is required');
const positiveInt = (field: string) =>
  z
    .number({ required_error: `${field} is required`, invalid_type_error: `${field} must be a number` })
    .int(`${field} must be an integer`)
    .positive(`${field} must be positive`);
const fileSize = positiveInt('fileSize').max(
  MAX_BOOK_SIZE,
  `fileSize exceeds the ${MAX_BOOK_SIZE}-byte limit for a book`,
);
// No book within the ceiling needs more parts than this, even in 5 MiB parts.
const partNumber = positiveInt('partNumber').max(
  MAX_BOOK_PARTS,
  `partNumber must be at most ${MAX_BOOK_PARTS}`,
);

export const startUploadSchema = z
  .object({
    uuid,
    fileSize,
    partSize: positiveInt('partSize')
      .min(MIN_PART_SIZE, `partSize must be at least ${MIN_PART_SIZE} bytes`)
      .max(MAX_PART_SIZE, `partSize must be at most ${MAX_PART_SIZE} bytes`),
  })
  .strip();

export const partUrlsSchema = z
  .object({
    uuid,
    uploadId,
    partNumbers: z
      .array(partNumber, { required_error: 'partNumbers is required' })
      .min(1, 'partNumbers is required')
      .max(MAX_PART_URLS_PER_REQUEST, `At most ${MAX_PART_URLS_PER_REQUEST} part URLs per request`),
  })
  .strip();

// GET /upload/parts takes its identifiers from the query string.
export const listPartsQuerySchema = z.object({ uuid, uploadId }).strip();

export const completeUploadSchema = z
  .object({
    uuid,
    uploadId,
    partCount: partNumber,
    // The size the client read from the file on disk, checked against the
    // parts before S3 assembles anything.
    fileSize,
  })
  .strip();

export const abortUploadSchema = z.object({ uuid, uploadId }).strip();

// Validated output shapes, declared explicitly for the same reason as
// externalResource.ts: no strictNullChecks, so z.infer is too loose to trust.
export type StartUploadBody = { uuid: string; fileSize: number; partSize: number };
export type PartUrlsBody = { uuid: string; uploadId: string; partNumbers: number[] };
export type ListPartsQuery = { uuid: string; uploadId: string };
export type CompleteUploadBody = { uuid: string; uploadId: string; partCount: number; fileSize: number };
export type AbortUploadBody = { uuid: string; uploadId: string };
