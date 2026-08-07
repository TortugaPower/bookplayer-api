// Audit log of state-mutating library sync operations.
// See docs/sync-operations-audit-plan.md.

export enum SyncOperationJobType {
  UPLOAD = 'upload',
  UPLOAD_CONFIRM = 'upload_confirm',
  UPLOAD_ARTWORK = 'upload_artwork',
  UPDATE = 'update',
  MOVE = 'move',
  RENAME = 'rename',
  DELETE = 'delete',
  DELETE_FOLDER_MOVING = 'delete_folder_moving',
  REORDER = 'reorder',
  SET_BOOKMARK = 'set_bookmark',
  MATCH_UUIDS = 'match_uuids',
  EXTERNAL_RESOURCE_PUT = 'external_resource_put',
  EXTERNAL_RESOURCE_DELETE = 'external_resource_delete',
}

export type SyncOperationOutcome = 'applied' | 'error';

export interface SyncOperationRecord {
  user_id: number;
  job_type: SyncOperationJobType | string;
  http_method: string;
  route: string;
  item_uuid?: string | null;
  relative_path?: string | null;
  params?: unknown;
  status_code?: number | null;
  outcome: SyncOperationOutcome;
  error_message?: string | null;
  app_version?: string | null;
}
