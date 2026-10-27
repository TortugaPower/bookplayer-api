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

  // /v1/billing (web subscriptions through Stripe). Upper-case on the wire,
  // unlike the codes above: the web client shares these names with the other
  // TortugaPower APIs that sell through Stripe Checkout.
  //
  // The catalog (STRIPE_PLANS) has no such price_id.
  PRICE_INVALID = 'PRICE_INVALID',
  // success_url / cancel_url / return_url is not on BILLING_RETURN_ORIGINS.
  RETURN_URL_NOT_ALLOWED = 'RETURN_URL_NOT_ALLOWED',
  // Checkout refused: a live Stripe subscription, or an active pro/lite
  // entitlement from a store, already covers this account.
  ALREADY_SUBSCRIBED = 'ALREADY_SUBSCRIBED',
  // Change-plan target is the plan the subscription is already on.
  ALREADY_ON_PLAN = 'ALREADY_ON_PLAN',
  // A Stripe customer exists, but no live subscription to change.
  NO_SUBSCRIPTION = 'NO_SUBSCRIPTION',
  // No Stripe customer for this account (never bought on the web; a store
  // purchase is managed in that store).
  BILLING_NO_CUSTOMER = 'BILLING_NO_CUSTOMER',
  // An upgrade is waiting on the bank (3DS, slow payment); it applies itself
  // once the charge clears.
  UPGRADE_PAYMENT_PENDING = 'UPGRADE_PAYMENT_PENDING',
  // Billing is not configured (no STRIPE_SECRET_KEY), or Stripe/RevenueCat
  // could not confirm the account's state. Retry later.
  BILLING_UNAVAILABLE = 'BILLING_UNAVAILABLE',
  // The session names an account that is gone or deactivated (a deleted
  // account whose token is still valid). Retrying can't help: sign in again.
  ACCOUNT_INACTIVE = 'ACCOUNT_INACTIVE',
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
