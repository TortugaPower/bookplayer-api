// Machine-readable codes the clients branch on, sent as `error` next to
// `message`, as the passkey routes already do: iOS decodes that key into
// `networkErrorWithCode`. Keep them stable. A code marks a request that can
// never succeed as sent, so the apps stop retrying and show it; anything
// without one is retried as before.
export enum ApiErrorCode {
  // The subscription check failed. The apps confirm the lapse against
  // RevenueCat before clearing their queues.
  NOT_SUBSCRIBED = 'not_subscribed',
  // Subscribed, but on a tier without this feature (e.g. LITE asking for S3).
  TIER_REQUIRED = 'tier_required',
  // No row, active or deleted, has the uuid (or, without one, the key) the
  // request names. An item the user deleted answers success instead: the
  // request's intent no longer applies.
  ITEM_NOT_FOUND = 'item_not_found',
  // An upload's uuid already belongs to an item of a different type.
  UUID_CONFLICT = 'uuid_conflict',
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
