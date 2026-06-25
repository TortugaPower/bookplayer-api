/**
 * One-off fix: rename external_resources columns from camelCase to snake_case
 * to match the project's snake_case column convention.
 *
 * Idempotent — each column is only renamed if the camelCase column still exists
 * and the snake_case one doesn't, so it's safe to run on a database that was
 * already created with the corrected (snake_case) names.
 *
 * Run:  npx ts-node scripts/rename-external-resources-columns.ts
 * (reads DB_* from your .development.env / environment, same as the app)
 */
import db from '../src/database';

const TABLE = 'external_resources';

const RENAMES: Array<[camel: string, snake: string]> = [
  ['providerName', 'provider_name'],
  ['providerId', 'provider_id'],
  ['syncStatus', 'sync_status'],
  ['lastSyncedAt', 'last_synced_at'],
  ['processedFile', 'processed_file'],
  ['hostId', 'host_id'],
];

async function main(): Promise<void> {
  const hasTable = await db.schema.hasTable(TABLE);
  if (!hasTable) {
    console.log(`Table "${TABLE}" does not exist — nothing to do.`);
    return;
  }

  let renamed = 0;
  for (const [camel, snake] of RENAMES) {
    const hasCamel = await db.schema.hasColumn(TABLE, camel);
    const hasSnake = await db.schema.hasColumn(TABLE, snake);

    if (hasCamel && !hasSnake) {
      await db.schema.alterTable(TABLE, (table) => {
        table.renameColumn(camel, snake);
      });
      console.log(`✓ renamed ${camel} -> ${snake}`);
      renamed++;
    } else if (hasSnake) {
      console.log(`• ${snake} already present — skipping`);
    } else {
      console.log(`! neither ${camel} nor ${snake} found — skipping`);
    }
  }

  console.log(`\nDone. ${renamed} column(s) renamed.`);
}

main()
  .then(() => db.destroy())
  .catch(async (err) => {
    console.error('Failed to rename columns:', err);
    await db.destroy();
    process.exit(1);
  });
