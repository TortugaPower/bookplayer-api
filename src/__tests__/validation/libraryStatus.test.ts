import { describe, it, expect } from '@jest/globals';
import { libraryStatusSchema } from '../../validation/libraryStatus';

describe('libraryStatusSchema', () => {
  it('accepts any strings, so one malformed local uuid cannot fail the pass', () => {
    const parsed = libraryStatusSchema.safeParse({
      uuids: ['2c2d0f44-1111-4111-8111-111111111111', 'Optional("x")', ''],
      extra: true,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      uuids: ['2c2d0f44-1111-4111-8111-111111111111', 'Optional("x")', ''],
    });
  });

  it('accepts an empty library', () => {
    expect(libraryStatusSchema.safeParse({ uuids: [] }).success).toBe(true);
  });

  it.each([
    ['a missing list', {}],
    ['a list that is not an array', { uuids: 'abc' }],
    ['entries that are not strings', { uuids: [1, 2] }],
  ])('rejects %s', (_label, body) => {
    expect(libraryStatusSchema.safeParse(body).success).toBe(false);
  });
});
