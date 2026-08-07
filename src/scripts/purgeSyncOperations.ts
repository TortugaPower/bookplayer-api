// Retention for the sync_operations audit log. Deletes rows untouched for
// SYNC_AUDIT_RETENTION_DAYS (default 90). Run from an external scheduled task
// (ECS scheduled task / cron), e.g. `node dist/scripts/purgeSyncOperations.js`.
// See docs/sync-operations-audit-plan.md.
import database from '../database';
import { logger } from '../services/LoggerService';
import { SyncAuditDB } from '../services/db/SyncAuditDB';

async function main(): Promise<void> {
  const days = parseInt(process.env.SYNC_AUDIT_RETENTION_DAYS || '90', 10);
  const removed = await new SyncAuditDB().purgeOlderThan(days);
  logger.log({
    origin: 'purgeSyncOperations',
    message: `Purged ${removed} sync_operations rows older than ${days} days`,
  });
}

main()
  .catch((err) => {
    logger.log(
      { origin: 'purgeSyncOperations', message: err.message },
      'error',
    );
    process.exitCode = 1;
  })
  .finally(() => database.destroy());
