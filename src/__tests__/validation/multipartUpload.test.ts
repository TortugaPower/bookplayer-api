import { describe, it, expect } from '@jest/globals';
import { partUrlsSchema } from '../../validation/multipartUpload';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('partUrlsSchema', () => {
  it('accepts repeated part numbers: the service collapses them before its 32 cap', () => {
    expect(partUrlsSchema.safeParse({ uuid, uploadId: 'up-1', partNumbers: Array(40).fill(1) }).success).toBe(true);
  });

  it('caps the raw list at 10,000 entries, the most distinct parts an upload can have', () => {
    const result = partUrlsSchema.safeParse({ uuid, uploadId: 'up-1', partNumbers: Array(10_001).fill(1) });

    expect(result.success).toBe(false);
  });
});
