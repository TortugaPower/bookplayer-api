import { IRequest, IResponse, INext } from '../../types/http';
import { logger } from '../../services/LoggerService';
import { isValidUUID } from '../../utils';
import { SyncAuditDB } from '../../services/db/SyncAuditDB';
import { SyncOperationJobType } from '../../types/syncOperation';

const syncAuditDB = new SyncAuditDB();

// Maps a matched library route (METHOD + router-relative path) to a job type.
// Only state-mutating routes appear here; GET reads are absent and skipped.
const JOB_TYPE_BY_ROUTE: Record<string, SyncOperationJobType> = {
  'PUT /': SyncOperationJobType.UPLOAD,
  'POST /external_set': SyncOperationJobType.UPLOAD_CONFIRM,
  'POST /thumbnail_set': SyncOperationJobType.UPLOAD_ARTWORK,
  'POST /': SyncOperationJobType.UPDATE,
  'POST /move': SyncOperationJobType.MOVE,
  'POST /rename': SyncOperationJobType.RENAME,
  'DELETE /': SyncOperationJobType.DELETE,
  'DELETE /folder_in_out': SyncOperationJobType.DELETE_FOLDER_MOVING,
  'POST /reorder': SyncOperationJobType.REORDER,
  'PUT /bookmark': SyncOperationJobType.SET_BOOKMARK,
  'POST /uuids': SyncOperationJobType.MATCH_UUIDS,
  'PUT /external': SyncOperationJobType.EXTERNAL_RESOURCE_PUT,
  'DELETE /external': SyncOperationJobType.EXTERNAL_RESOURCE_DELETE,
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
 *   playback-only `update`s.
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
