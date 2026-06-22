import { Knex } from 'knex';

// Adds the global `use_cloudfront_downloads` toggle to the `configs` table.
// When 'true', the API hands clients CloudFront signed URLs for downloads
// instead of S3 presigned URLs (see LibraryService GET branches). Default
// 'false' keeps the existing S3 behaviour, so the flip is safe and instantly
// reversible (UPDATE the row + ConfigService.invalidate).
//
// `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, and the new
// value cannot be used in the same transaction that adds it. Disable Knex's
// wrapping transaction so each statement autocommits.
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TYPE param_config_type ADD VALUE IF NOT EXISTS 'use_cloudfront_downloads'`,
  );
  await knex.raw(`
    INSERT INTO configs (config, value, value_type)
    SELECT 'use_cloudfront_downloads', 'false', 'boolean'
    WHERE NOT EXISTS (
      SELECT 1 FROM configs WHERE config = 'use_cloudfront_downloads'
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Remove the seeded row only. Postgres cannot drop an enum value, and `up`
  // is idempotent, so the enum addition is intentionally left in place.
  await knex.raw(
    `DELETE FROM configs WHERE config = 'use_cloudfront_downloads'`,
  );
}
