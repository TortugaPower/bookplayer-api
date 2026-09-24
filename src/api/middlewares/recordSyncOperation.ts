import { IRequest, IResponse, INext } from '../../types/http';
import { logger } from '../../services/LoggerService';
import { isValidUUID } from '../../utils';
import { SyncAuditDB } from '../../services/db/SyncAuditDB';
import { SyncOperationJobType } from '../../types/syncOperation';
import { ApiErrorCode } from '../../types/apiError';

const syncAuditDB = new SyncAuditDB();

// Maps a matched library route (METHOD + router-relative path) to a job type.
// Only state-mutating routes appear here; GET reads are absent and skipped.
const JOB_TYPE_BY_ROUTE: Record<string, SyncOperationJobType> = {
  'PUT /': SyncOperationJobType.UPLOAD,
  'POST /thumbnail_set': SyncOperationJobType.UPLOAD_ARTWORK,
  'POST /': SyncOperationJobType.UPDATE,
  'POST /move': SyncOperationJobType.MOVE,
  'POST /rename': SyncOperationJobType.RENAME,
  'DELETE /': SyncOperationJobType.DELETE,
  'DELETE /folder_in_out': SyncOperationJobType.DELETE_FOLDER_MOVING,
  'PUT /bookmark': SyncOperationJobType.SET_BOOKMARK,
  'POST /uuids': SyncOperationJobType.MATCH_UUIDS,
  'PUT /external': SyncOperationJobType.EXTERNAL_RESOURCE_PUT,
  'DELETE /external': SyncOperationJobType.EXTERNAL_RESOURCE_DELETE,
  // Part-URL requests are left out: one per window top-up, no forensic value.
  'POST /upload/start': SyncOperationJobType.UPLOAD_START,
  'POST /upload/complete': SyncOperationJobType.UPLOAD_COMPLETE,
  'POST /upload/abort': SyncOperationJobType.UPLOAD_ABORT,
};

// Fields on an `update` body that are identifiers or playback state, not
// structural changes. An update touching only these carries no forensic value
// and is high-frequency (progress ticks), so it is dropped.
const NON_STRUCTURAL_UPDATE_KEYS = new Set([
  'relativePath',
  'key',
  'uuid',
  // `id` is the client's item identifier, sent on every update including plain
  // progress ticks; like relativePath/uuid it's not a change. Without it,
  // progress-only updates leak past this filter and get logged (seen in prod).
  'id',
  // originalFileName is an identifier the update handler ignores, not a change.
  'originalFileName',
  'currentTime',
  'lastPlayDateTimestamp',
  'lastPlayDate',
  'percentCompleted',
  'speed',
  'isFinished',
]);

export function jobTypeFor(req: IRequest): SyncOperationJobType | undefined {
  const routePath = req.route?.path;
  if (!routePath) return undefined; // no matched route (e.g. 404)
  return JOB_TYPE_BY_ROUTE[`${req.method} ${routePath}`];
}

export function isProgressOnlyUpdate(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const keys = Object.keys(body as Record<string, unknown>);
  return keys.every((k) => NON_STRUCTURAL_UPDATE_KEYS.has(k));
}

const MAX_PARAMS_BYTES = 8192;

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

// The global error handler and controller catch-blocks send the error body
// through res.send(<stringified JSON>), so the captured payload is usually the
// JSON string `{"status":..,"message":".."}` rather than the object. Parse it
// back out to store just the message.
export function extractMessage(payload: unknown): string | null {
  let message: unknown = null;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      message =
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>).message ?? payload
          : payload;
    } catch {
      message = payload;
    }
  } else if (payload && typeof payload === 'object') {
    message = (payload as Record<string, unknown>).message ?? null;
  }
  return typeof message === 'string' ? message.slice(0, 512) : null;
}

// The `error` code next to the message, when the response carries one.
export function extractErrorCode(payload: unknown): string | null {
  let body: unknown = payload;
  if (typeof payload === 'string') {
    try {
      body = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null;
  return typeof code === 'string' ? code : null;
}

// Account-level rejections come from apps that retry the same task every 5
// seconds forever (a lapsed subscription whose queue never cleared). The first
// one per window is worth a row; the rest would only bump that row's counter,
// one DB write each. Kept per API process: with a few ECS tasks that is still
// a handful of writes per user per window.
const ACCOUNT_LEVEL_CODES = new Set<string>([
  ApiErrorCode.NOT_SUBSCRIBED,
  ApiErrorCode.TIER_REQUIRED,
]);
const ACCOUNT_REJECTION_WINDOW_MS = 10 * 60 * 1000;
const MAX_THROTTLE_ENTRIES = 10_000;
const lastAccountRejection = new Map<string, number>();

export function shouldRecordAccountRejection(key: string, now = Date.now()): boolean {
  const last = lastAccountRejection.get(key);
  if (last !== undefined && now - last < ACCOUNT_REJECTION_WINDOW_MS) return false;
  if (lastAccountRejection.size >= MAX_THROTTLE_ENTRIES) {
    for (const [entry, at] of lastAccountRejection) {
      if (now - at >= ACCOUNT_REJECTION_WINDOW_MS) lastAccountRejection.delete(entry);
    }
    if (lastAccountRejection.size >= MAX_THROTTLE_ENTRIES) lastAccountRejection.clear();
  }
  lastAccountRejection.set(key, now);
  return true;
}

export function resetAccountRejectionThrottle(): void {
  lastAccountRejection.clear();
}

// Store the request body for forensics, minus content with no forensic value:
// bookmark note/title are user free-text (already persisted in the bookmarks
// table), and an oversized body is replaced with a size marker to bound rows.
export function sanitizeParams(jobType: SyncOperationJobType, body: unknown): unknown {
  if (!body || typeof body !== 'object') return body ?? null;
  let out = body as Record<string, unknown>;
  if (jobType === SyncOperationJobType.SET_BOOKMARK) {
    const clone = { ...out };
    delete clone.note;
    delete clone.title;
    out = clone;
  }
  const serialized = JSON.stringify(out);
  if (serialized && serialized.length > MAX_PARAMS_BYTES) {
    return { _truncated: true, _bytes: serialized.length };
  }
  return out;
}

/**
 * Records every state-mutating /v1/library request into `sync_operations`,
 * fire-and-forget, so a user's operation sequence can be replayed during a
 * corruption investigation. Mounted at the top of LibraryRouter.
 *
 * - Captures the final status via `res.on('finish')` and the response body via
 *   thin wrappers over res.json/res.send (errors go out through res.send in the
 *   global error handler; successes through res.json).
 * - Logs nothing for reads (routes absent from JOB_TYPE_BY_ROUTE) or for
 *   playback-only `update`s, and at most one account-level rejection
 *   (`not_subscribed`, `tier_required`) per user, job type and code every 10
 *   minutes.
 * - Gated by SYNC_AUDIT_ENABLED=true.
 */
export const recordSyncOperation = (
  req: IRequest,
  res: IResponse,
  next: INext,
) => {
  if (process.env.SYNC_AUDIT_ENABLED !== 'true') return next();

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  res.json = (body: unknown) => {
    res.locals.__syncAuditPayload = body;
    return originalJson(body);
  };
  res.send = (body: unknown) => {
    res.locals.__syncAuditPayload = body;
    return originalSend(body);
  };

  res.on('finish', () => {
    try {
      const jobType = jobTypeFor(req);
      if (!jobType) return; // not a mutating route
      if (!req.user?.id_user) return; // unauthenticated
      if (jobType === SyncOperationJobType.UPDATE && isProgressOnlyUpdate(req.body)) {
        return;
      }

      const status = res.statusCode;
      const outcome = status >= 200 && status < 400 ? 'applied' : 'error';
      if (outcome === 'error') {
        const code = extractErrorCode(res.locals.__syncAuditPayload);
        if (
          code &&
          ACCOUNT_LEVEL_CODES.has(code) &&
          !shouldRecordAccountRejection(`${req.user.id_user}:${jobType}:${code}`)
        ) {
          return;
        }
      }
      const body = req.body ?? {};
      const rawPath =
        pickString(body.relativePath) ??
        pickString(body.key) ??
        pickString(body.path) ??
        pickString(body.origin);

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      syncAuditDB.record({
        user_id: req.user.id_user,
        job_type: jobType,
        http_method: req.method,
        route: req.route?.path ?? req.path,
        item_uuid:
          typeof body.uuid === 'string' && isValidUUID(body.uuid)
            ? body.uuid
            : null,
        relative_path: rawPath ? rawPath.slice(0, 1024) : null,
        params: sanitizeParams(jobType, body),
        status_code: status,
        outcome,
        error_message:
          outcome === 'error'
            ? extractMessage(res.locals.__syncAuditPayload)
            : null,
        // varchar(16): truncate for parity with the other bounded columns so a
        // stray long value can't throw the insert and silently drop the row.
        app_version: req.app_version
          ? String(req.app_version).slice(0, 16)
          : null,
      });
    } catch (err) {
      logger.log({
        origin: 'recordSyncOperation',
        message: err.message,
      });
    }
  });

  next();
};

export default recordSyncOperation;
