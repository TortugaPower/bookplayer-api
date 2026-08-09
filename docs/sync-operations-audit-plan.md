# Sync Operations Audit Log — Implementation Plan

## Motivation

There is no server-side record of the ordered sequence of state-mutating sync
operations a client executes. Mutations are applied directly to `library_items`;
the only retained history is soft-deleted rows (unordered), `updated_at` (not
bumped on every path), and ephemeral Winston logs. When a library reaches a
corrupt state (e.g. the same folder uploaded twice under two names/uuids, one
copy soft-deleted, the client wedged on `uploadArtwork` → "Item not exists"), we
cannot reconstruct **what operation caused it or in what order** — we reverse-
engineer it from row timestamps and S3 listings.

`sync_operations` records the ordered operation stream so a corruption case can
be **replayed** instead of guessed.

### Forensic questions it must answer
- In what order did user X's mutations arrive, and which succeeded/failed?
- What deactivated / re-keyed / duplicated item Y, and when?
- Which client operation produced the error that wedged the queue?

### Non-goals
- Not event-sourcing — we do not rebuild `library_items` from it.
- Not read/sync-down logging — state changes only.
- Must **never** break or measurably slow a sync request.

## Locked decisions
| Decision | Choice |
|---|---|
| Storage | Postgres table (queryable, joinable to `library_items`) |
| Retention | Plain (non-partitioned) table + nightly `DELETE` on `last_seen_at`, 90-day window |
| Phase-1 scope | Envelope middleware + noise filters only — **no per-handler edits** |
| Playback progress/time updates | **Dropped entirely** (never logged) |
| Client task-id correlation | **Deferred** (P3) — correlate by uuid + relativePath + timestamp for now |

## Where it writes — one middleware, fire-and-forget

Mount a `recordSyncOperation` middleware on `LibraryRouter`. It fires **after**
the handler resolves, capturing the request envelope + response outcome.

- Wrap `res.json` to capture status code and (on error) the error message, then
  perform a **non-awaited** write via a new `SyncAuditDB`. A logging failure is
  swallowed and can never fail or delay the sync request.
- Runs only when `req.user` exists and the route is state-mutating.
- Because it captures the raw body, the **failing** case (the highest-value
  record) is logged too.
- `req.user` (`{ id_user, email, external_id }`, from `auth.ts`) and
  `req.app_version` (from `version.ts`, the `accept-version` header) are already
  populated upstream.

### Route → job_type map
| method + path | job_type |
|---|---|
| `PUT /` | `upload` |
| `POST /external_set` | `upload_confirm` |
| `POST /thumbnail_set` | `upload_artwork` |
| `POST /` | `update` |
| `POST /move` | `move` |
| `POST /rename` | `rename` |
| `DELETE /` | `delete` |
| `DELETE /folder_in_out` | `delete_folder_moving` |
| `POST /reorder` | `reorder` |
| `PUT /bookmark` | `set_bookmark` |
| `POST /uuids` | `match_uuids` |
| `PUT /external` / `DELETE /external` | `external_resource_put` / `external_resource_delete` |

GET routes (`/`, `/keys`, `/last_played`, bookmarks reads) are not in the map →
never logged.

## Noise controls (why P1 stays middleware-only)

### 1. Retry-storm coalescing
A wedged task retries the same failing endpoint every 5s forever (~17k identical
rows/day for one user). Collapse consecutive identical failures into one row
with a counter.

- `fingerprint = md5(job_type || ':' || coalesce(item_uuid,'') || ':' ||
  coalesce(relative_path,'') || ':' || coalesce(error_message,''))`, set on
  **error** rows only.
- Write is an upsert against a **partial unique index**
  `(user_id, fingerprint) WHERE outcome = 'error'`:
  ```sql
  INSERT INTO sync_operations (...) VALUES (...)
  ON CONFLICT (user_id, fingerprint) WHERE outcome = 'error'
  DO UPDATE SET occurrence_count = sync_operations.occurrence_count + 1,
                last_seen_at     = now(),
                status_code      = excluded.status_code,
                app_version      = excluded.app_version;
  ```
- A task retrying 5,000× → **one row**: "failed, first seen T, still failing at
  T+X, 5,000×." More useful than 5,000 duplicates, and bounded.
- Successful mutations are never retried by the client (task dropped on success),
  so `applied` rows are naturally distinct and correctly ordered — they are plain
  inserts, never coalesced.
- **Bonus:** high `occurrence_count` error rows are a ready-made "wedged users"
  signal — a dashboard/alert falls out for free.

### 2. Drop playback-progress updates
The `update` job (`POST /`) carries either structural changes or playback-only
state. Log only the structural ones.

- Non-structural key set = the identifier fields the update handler ignores
  (`relativePath`, `key`, `uuid`, `originalFileName`) **plus** the playback-only
  fields (`currentTime`, `lastPlayDateTimestamp`, `lastPlayDate`,
  `percentCompleted`, `speed`, `isFinished`). The identifiers must be included —
  a real progress tick always carries an item identifier, so without them the
  predicate would never fire.
- Predicate: for `job_type = update`, if every key in the body is in that set →
  **skip**. If the body touches any field outside it → log (mixed payloads are
  logged; err toward keeping anything structural).
- No forensic loss: playback position lives in `library_items` / playback records.

## Schema

```sql
CREATE TABLE sync_operations (
  id                bigserial    PRIMARY KEY,
  user_id           integer      NOT NULL,
  occurred_at       timestamptz  NOT NULL DEFAULT now(),  -- server receive time
  job_type          varchar(40)  NOT NULL,
  http_method       varchar(8)   NOT NULL,
  route             varchar(64)  NOT NULL,
  item_uuid         uuid,                                 -- body.uuid (validated; null if malformed)
  relative_path     varchar(1024),                        -- body.relativePath / key (truncated)
  params            jsonb,                                -- request body, sanitized + size-bounded (no secrets; JWT is header-only)
  status_code       integer,
  outcome           varchar(12)  NOT NULL,                -- 'applied' | 'error'
  error_message     varchar(512),
  app_version       varchar(16),
  fingerprint       text,                                 -- errors only (see coalescing)
  first_seen_at     timestamptz  NOT NULL DEFAULT now(),
  last_seen_at      timestamptz  NOT NULL DEFAULT now(),
  occurrence_count  integer      NOT NULL DEFAULT 1
  -- P2 (deferred): resolved_item_ids integer[], outcome may add 'no_op'
  -- P3 (deferred): client_task_id uuid  (from X-BP-Task-Id header)
);

-- primary forensic query: a user's operations in order
CREATE INDEX sync_ops_user_time ON sync_operations (user_id, occurred_at);
-- "history of this item"
CREATE INDEX sync_ops_item_uuid ON sync_operations (item_uuid) WHERE item_uuid IS NOT NULL;
-- retry coalescing
CREATE UNIQUE INDEX sync_ops_error_fingerprint
  ON sync_operations (user_id, fingerprint) WHERE outcome = 'error';
-- retention purge scans by last_seen_at
CREATE INDEX sync_ops_last_seen ON sync_operations (last_seen_at);
```

`params` bodies on these routes are small and carry no secrets (the JWT is a
header, never in the body). We store the body but: drop bookmark `note`/`title`
(user free-text already persisted in `bookmarks`, no forensic value) and replace
any body over `MAX_PARAMS_BYTES` (8 KB) with a `{ _truncated, _bytes }` marker so
a pathological payload can't bloat rows.

Config (both optional; absence = inert / defaults):
`SYNC_AUDIT_ENABLED=true` turns the middleware on; `SYNC_AUDIT_RETENTION_DAYS`
(default 90) bounds the purge.

## Retention
Retention runs **outside this repo** in the `sync-audit-reaper` Lambda
(`~/Workspace/BookPlayer/sync-audit-reaper`), triggered daily by EventBridge
Scheduler (`sync-audit-reaper-schedule`, 09:30 UTC). It executes
`DELETE FROM sync_operations WHERE last_seen_at < now() - interval '90 days'`
(keyed on `last_seen_at` so an actively-wedged user's coalesced row survives) and
connects via RDS IAM auth over the VPC (no Secrets Manager, no NAT). The API repo
deliberately owns no retention code.

## Phasing
- **P1 — envelope middleware + noise filters (this plan):** `recordSyncOperation`
  middleware, `SyncAuditDB`, migration, fingerprint/predicate helper, retention
  job. ~4–5 files, no handler edits. Delivers the ordered-sequence forensic win.
- **P2 — handler enrichment (deferred):** services report `resolved_item_ids`
  and distinguish `no_op` vs `applied` (e.g. a rename that merged vs. rewrote).
  Touches ~12 handlers. Do only if P1 leaves real gaps.
- **P3 — client correlation (deferred):** iOS sends `X-BP-Task-Id` per request;
  log `client_task_id` for a direct client-queue ↔ server-row join. Small iOS
  change; couples rollout to an app release, so defer until needed.

## Rollout & validation
- Ship behind a config flag.
- Validate on staging: run a multi-part import + a rename + a delete; read back
  the ordered rows; confirm progress updates are absent and a forced failure
  coalesces into a single incrementing row.
- **Wire into the `debug-sync` skill / support flow:** a "recent operations for
  this user" query becomes step 0 of every sync investigation.
- No backfill — accumulates from deploy.

## Deliverables (P1 ticket list)
1. Migration: `create_sync_operations` (table + 3 indexes).
2. `src/services/db/SyncAuditDB.ts` — `record(op)` upsert (coalescing) + a
   `recentForUser(user_id, limit)` read for the support flow.
3. `src/api/middlewares/recordSyncOperation.ts` — route→job_type map, progress
   predicate, `res.json` wrap, fire-and-forget call to `SyncAuditDB`.
4. Mount the middleware on `LibraryRouter`.
5. Retention job (nightly DELETE).
6. Config flag + staging validation script.
```
