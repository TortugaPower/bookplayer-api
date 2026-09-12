// The per-repository half of the sandbox. Everything else in this directory is portable; this file and
// `../review-guide.md` are the two that change when the harness is copied to another repository. A copy that
// keeps these lists gets rules that match nothing of its own and no rule naming its secret files — so review
// both when you port.

// Files in the checkout that hold credentials even though they are gitignored. The generic path rules already
// refuse `.env`; this repository's env files are named `development.env` / `.development.env` (which may point
// DB_HOST at a production database), and the CloudFront signing key lives in a `.pem` beside the code when
// someone rotates it. `development.env.template` stays readable, as every `.template` does.
export const REPO_SECRET_FILES = ['development.env', '.development.env', 'cloudfront_private_key.pem'];

// Secret SHAPES this repository's code, configuration and logs can contain, applied by `redact` after the generic
// ones (Anthropic keys, GitHub tokens, PEM private keys). Each entry carries the example(s) that prove it and a
// look-alike that must pass untouched: the harness's own test runs both, so a shape cannot be listed without
// working and cannot eat prose.
export const REPO_SECRET_SHAPES = [
  {
    // A connection string with credentials in it: the database and Redis URLs are env values, and a stack trace
    // or a knex error can carry one whole.
    // The user part may be empty: Redis URLs are usually `redis://:password@host`.
    pattern: /\b(postgres(?:ql)?|mysql|redis|rediss|mongodb):\/\/[^\s:@\/]*:[^\s@\/]+@/gi,
    replacement: '$1://[redacted]@',
    example: ['postgres://bookplayer:hunter2@db.internal:5432/app failed', 'REDIS_URL=redis://:s3cret@cache.internal:6379/0'],
    keeps: 'redis://cache.internal:6379/0 has no credentials in it',
  },
  {
    // RevenueCat secret API keys (`sk_…`); the public `appl_`/`goog_` keys are not secrets.
    pattern: /\bsk_[A-Za-z0-9]{24,}\b/g,
    replacement: '[redacted revenuecat key]',
    example: 'REVENUECAT_KEY=sk_' + 'A1b2C3d4'.repeat(4),
    keeps: 'the sk_ prefix marks a secret key; the app uses appl_ and goog_ public ones',
  },
  {
    // An AWS access key id: the deploy still uses static keys, and a developer's are one grep away in an env file.
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[redacted aws key id]',
    example: 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    keeps: 'the AKIA prefix marks a long-term key',
  },
];
