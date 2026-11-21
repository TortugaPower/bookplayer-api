import { afterEach, describe, expect, it } from '@jest/globals';
import JWT from 'jsonwebtoken';
import { googleClientIds, isGoogleIdToken } from '../../utils/idToken';

const token = (claims: Record<string, unknown>) => JWT.sign(claims, 'not-a-real-key');

describe('isGoogleIdToken', () => {
  it("is true for Google's issuer, with or without the scheme", () => {
    expect(isGoogleIdToken(token({ iss: 'https://accounts.google.com' }))).toBe(true);
    expect(isGoogleIdToken(token({ iss: 'accounts.google.com' }))).toBe(true);
  });

  it("is false for Apple's issuer, a missing issuer and anything that isn't a JWT", () => {
    expect(isGoogleIdToken(token({ iss: 'https://appleid.apple.com' }))).toBe(false);
    expect(isGoogleIdToken(token({ sub: 'no-issuer' }))).toBe(false);
    expect(isGoogleIdToken('apple-token')).toBe(false);
    expect(isGoogleIdToken('')).toBe(false);
  });
});

describe('googleClientIds', () => {
  const original = process.env.GOOGLE_CLIENT_ID;
  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = original;
  });

  it('reads one client, or several separated by commas, ignoring spaces and blanks', () => {
    process.env.GOOGLE_CLIENT_ID = 'android.apps.googleusercontent.com';
    expect(googleClientIds()).toEqual(['android.apps.googleusercontent.com']);
    process.env.GOOGLE_CLIENT_ID = ' android.apps.googleusercontent.com , web.apps.googleusercontent.com,';
    expect(googleClientIds()).toEqual([
      'android.apps.googleusercontent.com',
      'web.apps.googleusercontent.com',
    ]);
  });
});
