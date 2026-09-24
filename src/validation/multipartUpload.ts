import { z } from 'zod';
import { MAX_PARTS } from '../types/multipartUpload';

// Request-body schemas for /v1/library/upload/*. Range checks that depend on
// each other (partSize vs fileSize) live in MultipartUploadService.

const uuid = z
  .string({ required_error: 'A valid item uuid is required' })
  .uuid('A valid item uuid is required');
const uploadId = z
  .string({ required_error: 'uploadId is required' })
  .trim()
  .min(1, 'uploadId is required');
const positiveInt = (field: string) =>
  z
    .number({ required_error: `${field} is required`, invalid_type_error: `${field} must be a number` })
    .int(`${field} must be an integer`)
    .positive(`${field} must be positive`);
const partNumber = positiveInt('partNumber').max(MAX_PARTS, `partNumber must be at most ${MAX_PARTS}`);

export const startUploadSchema = z
  .object({
    uuid,
    fileSize: positiveInt('fileSize'),
    partSize: positiveInt('partSize'),
  })
  .strip();

export const partUrlsSchema = z
  .object({
    uuid,
    uploadId,
    // The per-request cap is enforced after de-duplication in
    // MultipartUploadService, which answers it with `code: invalid_request`.
    partNumbers: z
      .array(partNumber, { required_error: 'partNumbers is required' })
      .min(1, 'partNumbers is required')
      // No valid request has more distinct part numbers than an upload has parts.
      .max(MAX_PARTS, `partNumbers can list at most ${MAX_PARTS} numbers`),
  })
  .strip();

// GET /upload/parts takes its identifiers from the query string.
export const listPartsQuerySchema = z.object({ uuid, uploadId }).strip();

export const completeUploadSchema = z
  .object({
    uuid,
    uploadId,
    partCount: positiveInt('partCount').max(MAX_PARTS, `partCount must be at most ${MAX_PARTS}`),
    // The size the client read from the file on disk, checked against the
    // parts before S3 assembles anything.
    fileSize: positiveInt('fileSize'),
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
