import JWT from 'jsonwebtoken';

/** How Google names itself as an ID token's issuer, with or without the scheme. */
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Whether an ID token says Google issued it. Read without verifying, only to
 * choose the verifier: the web sends Google and Apple tokens alike with
 * `x-platform: web`. The chosen verifier then checks the signature, issuer and
 * audience, so a token that merely claims Google is still refused there.
 */
export function isGoogleIdToken(token: string): boolean {
  const payload = JWT.decode(token);
  return typeof payload === 'object' && payload !== null && GOOGLE_ISSUERS.has(String(payload.iss));
}

/**
 * The Google OAuth clients whose ID tokens we accept: `GOOGLE_CLIENT_ID` holds
 * one or several, comma-separated (the Android app's and the web app's).
 */
export function googleClientIds(): string[] {
  return (process.env.GOOGLE_CLIENT_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
