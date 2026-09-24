import { describe, it, expect } from '@jest/globals';
import { stripStoragePrefix } from '../../utils';

/**
 * stripStoragePrefix is what keeps a legacy account's email address out of
 * CloudWatch: the per-user storage prefix is `users.external_id`, or that
 * address for accounts predating it (see StoragePrefixService). These cases
 * pin the edges so a later simplification cannot quietly reintroduce the leak.
 */
describe('stripStoragePrefix', () => {
  it('drops the prefix segment and keeps the rest of the key', () => {
    expect(stripStoragePrefix('someone@example.com/root/1_a.mp3')).toBe(
      'root/1_a.mp3',
    );
  });

  it('keeps every segment after the first', () => {
    expect(
      stripStoragePrefix('someone@example.com/TV/Bluey/S01/[E01] Bike.mp3'),
    ).toBe('TV/Bluey/S01/[E01] Bike.mp3');
  });

  it('returns empty for a bare prefix, rather than echoing the address', () => {
    expect(stripStoragePrefix('someone@example.com')).toBe('');
  });

  it('returns empty for missing or empty input', () => {
    expect(stripStoragePrefix(undefined)).toBe('');
    expect(stripStoragePrefix('')).toBe('');
  });

  it('handles an external_id prefix the same way', () => {
    expect(
      stripStoragePrefix('001172.22b2d822a90b45bf8c4d250c3dda4d6a.1714/root/x.m4b'),
    ).toBe('root/x.m4b');
  });
});
