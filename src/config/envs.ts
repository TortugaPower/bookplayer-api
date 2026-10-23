import path from 'path';
import envSchema from 'env-schema';
import S from 'fluent-json-schema';

export const Envs = () => {
  const result = require('dotenv').config({
    path: path.join(
      __dirname,
      `../../${process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : '.development'
      }.env`,
    ),
  });

  // In ECS/Docker, env vars are injected directly, so .env file may not exist
  // Only throw if file doesn't exist AND required env vars are missing
  if (result.error && !process.env.DB_HOST) {
    throw new Error(result.error);
  }

  const scheme = {
    // Use process.env directly (works with both .env file and injected env vars)
    data: process.env,
    schema: S.object()
      .prop(
        'NODE_ENV',
        S.string().enum(['development', 'testing', 'production']).required(),
      )
      .prop('API_PORT', S.string().required())
      .prop('DB_HOST', S.string().required())
      .prop('DB_USER', S.string().required())
      .prop('DB_PASSWORD', S.string().required())
      .prop('DB_DATABASE', S.string().required())
      .prop('S3_BUCKET', S.string().required())
      .prop('S3_REGION', S.string().required())
      .prop('APPLE_CLIENT_ID', S.string().required())
      .prop('GOOGLE_CLIENT_ID', S.string().required())
      .prop('APP_SECRET', S.string().required())
      .prop('REVENUECAT_HEADER', S.string().required())
      .prop('REVENUECAT_API', S.string().required())
      .prop('REVENUECAT_KEY', S.string().required())
      .prop('REVENUECAT_API_V2', S.string().required())
      .prop('REVENUECAT_API_V2_KEY', S.string().required())
      .prop('REVENUECAT_PROJECT_ID', S.string().required())
      // RC internal entitlement object ids -> tier. Stable per project; used to
      // translate v2 active_entitlements (which return internal ids) to tiers.
      .prop('REVENUECAT_ENTITLEMENT_PRO', S.string().required())
      .prop('REVENUECAT_ENTITLEMENT_PLUS', S.string().required())
      .prop('REVENUECAT_ENTITLEMENT_LITE', S.string().required())
      .prop('PROXY_FILE_URL', S.string().required())
      .prop('APP_VERSION', S.string().required())
      .prop('WEBAUTHN_RP_ID', S.string())
      .prop('WEBAUTHN_RP_NAME', S.string())
      // Development only (ignored when NODE_ENV=production): extra origins a local
      // web client may complete passkey ceremonies from, comma-separated.
      .prop('WEBAUTHN_EXTRA_ORIGINS', S.string())
      .prop('ANDROID_RELEASE_HASH', S.string().required())
      // Web billing (Stripe Checkout, linked to RevenueCat by its Stripe app).
      // All optional: without STRIPE_SECRET_KEY the /v1/billing routes answer
      // 503 BILLING_UNAVAILABLE and the rest of the API is unaffected.
      .prop('STRIPE_SECRET_KEY', S.string())
      // JSON array: [{ price_id, plan_code, name, amount, currency, interval }]
      .prop('STRIPE_PLANS', S.string())
      // Comma-separated origins (https://host) or schemes (bookplayer:) that
      // success/cancel/return URLs may point to.
      .prop('BILLING_RETURN_ORIGINS', S.string())
      .prop('STRIPE_PORTAL_CONFIGURATION_ID', S.string())
      .prop('STRIPE_TIMEOUT_MS', S.string()),
  };
  envSchema(scheme);
};

export default Envs;
