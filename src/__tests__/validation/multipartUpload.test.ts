import { describe, it, expect } from '@jest/globals';
import {
  completeUploadSchema,
  partUrlsSchema,
  startUploadSchema,
} from '../../validation/multipartUpload';

const uuid = '11111111-1111-4111-8111-111111111111';
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, body: unknown) =>
  schema.safeParse(body).success;

describe('startUploadSchema', () => {
  it('accepts a book up to the 10 GiB ceiling', () => {
    expect(ok(startUploadSchema, { uuid, fileSize: 10 * GiB, partSize: 64 * MiB })).toBe(true);
  });

  it.each([
    ['a book over the 10 GiB ceiling', { fileSize: 10 * GiB + 1, partSize: 64 * MiB }],
    ['a part under S3 minimum', { fileSize: 100 * MiB, partSize: 5 * MiB - 1 }],
    ['a part over S3 maximum', { fileSize: 10 * GiB, partSize: 5 * GiB + 1 }],
  ])('rejects %s', (_label, sizes) => {
    expect(ok(startUploadSchema, { uuid, ...sizes })).toBe(false);
  });
});

describe('partUrlsSchema', () => {
  it('accepts up to 32 part numbers up to 2,048', () => {
    const partNumbers = Array.from({ length: 32 }, (_, i) => 2017 + i);
    expect(ok(partUrlsSchema, { uuid, uploadId: 'up-1', partNumbers })).toBe(true);
  });

  it('rejects more than 32 part numbers in one request', () => {
    const partNumbers = Array.from({ length: 33 }, (_, i) => i + 1);
    expect(ok(partUrlsSchema, { uuid, uploadId: 'up-1', partNumbers })).toBe(false);
  });

  it('rejects a part number no book within the ceiling needs', () => {
    // 10 GiB in the smallest (5 MiB) parts is 2,048 parts.
    expect(ok(partUrlsSchema, { uuid, uploadId: 'up-1', partNumbers: [2049] })).toBe(false);
  });
});

describe('completeUploadSchema', () => {
  it('requires the file size, so complete can check the parts add up to it', () => {
    expect(ok(completeUploadSchema, { uuid, uploadId: 'up-1', partCount: 3 })).toBe(false);
    expect(ok(completeUploadSchema, { uuid, uploadId: 'up-1', partCount: 3, fileSize: 135 })).toBe(true);
  });

  it('rejects a book over the ceiling before anything is assembled', () => {
    expect(ok(completeUploadSchema, { uuid, uploadId: 'up-1', partCount: 161, fileSize: 10 * GiB + 1 })).toBe(false);
  });
});
