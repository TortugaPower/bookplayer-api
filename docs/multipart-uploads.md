# Multipart uploads

How a client uploads a book's file to S3. Replaces the single presigned PUT returned by `PUT /v1/library`, which
stays in place for clients that predate these routes.

## Why

A single `PutObject` tops out at 5 GiB (the 2026-09-20 inventory had 0 of 969,604 objects above it — a ceiling, not an
absence of big books), a stalled PUT restarts from byte zero, and the PUT URL is frozen into the client's queue even
though the task-role credentials that sign it expire within hours. Worse, older clients confirmed `synced:true` even
when S3 rejected the PUT, leaving rows that claim to be backed up with nothing in S3.

## Model

- **Stateless server.** The client keeps the `uploadId`. Every call names the item by `uuid`; the server resolves the
  caller's own active book and derives the key (`<prefix>/<source_path || key>`), so a client can only touch its own
  objects and never sends a key.
- **S3 is the source of truth.** Resuming and completing both read S3's part list. The client never sends ETags.
- **The server confirms.** `complete` is the only thing that sets `synced=true` for a multipart upload. For a book
  streamed in from a media server (Jellyfin, Audiobookshelf), it also marks the item's media-server resources
  `downloaded`: these routes are the only way a media-server book's file reaches S3. A Hardcover link on the same
  book is left alone — Hardcover has no file, and its `sync_status` is the client's own marker.
- **`synced` means the file is in S3, on every tier.** `PUT /` creates rows unsynced, and `POST /` ignores
  `synced:true` for a book with no object. So `GET /keys`, which lists synced rows, is "books whose file is in S3":
  a LITE account's books are left out of it on purpose, because LITE never uploads a file. **`/keys` is
  deprecated**: shipped builds compare their local paths against it in a one-off "upload what the server is missing"
  pass (iOS: an install's first sync; Android: a tier change), and it stays served for them. A path that is stale on
  that device (the item was moved or renamed on another one) reads as missing, and re-uploading it there moves the
  item back: `PUT /` treats a known uuid at a new key as a move. New clients use the
  [missing-items pass](#the-missing-items-pass), which asks by uuid.
- **One open upload per book.** `start` aborts whatever is still open for the book before opening a new one. Uploading
  the same book from two devices at once is unsupported: each device's `start` would cancel the other's upload. That
  is deliberate — a book's file is uploaded by the device it was imported on, and every other device downloads it.
- **A book deleted mid-upload leaves nothing behind.** If the row is gone by the time S3 finishes assembling the
  file, `complete` deletes the object and answers `item_not_found`; the lifecycle rule only reclaims *incomplete*
  uploads, so nothing else would.
- **Abandoned uploads are reclaimed** by the bucket rule `abort-incomplete-multipart-uploads` (7 days). Deleting a book
  also aborts its open uploads.

All routes are under `/v1/library/upload`, require an active subscription and the PRO tier, and are audited in
`sync_operations` (`upload_start`, `upload_complete`, `upload_abort`; part URLs are not logged).

## Routes

| Route | Body / query | Success |
|---|---|---|
| `POST /start` | `{ uuid, fileSize, partSize }` | `{ status: "started", uploadId, partSize, partCount }`, or `{ status: "exists" }` when the object is already in S3 (the row is marked synced). Aborts any upload still open for the book first — one open upload per book — so call it only when you hold no `uploadId`; with one, resume through `GET /parts`. |
| `POST /parts` | `{ uuid, uploadId, partNumbers }` (1–32 distinct part numbers; duplicates are ignored) | `{ parts: [{ partNumber, url, expiresAt }] }` |
| `GET /parts` | `?uuid=&uploadId=` | `{ parts: [{ partNumber, size }] }` |
| `POST /complete` | `{ uuid, uploadId, partCount, fileSize }` (`fileSize` read from the file on disk) | `{ synced: true }` |
| `POST /abort` | `{ uuid, uploadId }` | `{ aborted: true }` (also when already gone) |

Constraints: a book is at most **10 GiB** (a product ceiling; the longest known audiobook is ~1.7 GiB at 64 kbps and
~6.7 GiB at 256 kbps), so no part number is above 2,048. From S3: `partSize` between 5 MiB and 5 GiB, every part but the
last exactly `partSize`. The client PUTs each part's bytes to its URL with no extra headers (the signature covers `host` only).
`expiresAt` is a unix timestamp, but treat it as an upper bound: task-role credentials can end a URL sooner.

## Errors

Every error body is `{ message, error? }`: `error` is the stable code (the key the passkey routes already use, which iOS decodes into `networkErrorWithCode`). Branch on `error`, never on `message`.

| error | HTTP | Client action |
|---|---|---|
| `item_not_found` | 404 | No active book with that uuid. If the book still exists locally, re-register it through the sync lane; otherwise drop the upload. |
| `upload_not_found` | 409 | S3 no longer has the upload (aborted or reclaimed). Forget the `uploadId` and `start` again. Counts against the restart budget. |
| `parts_missing` | 409 | `complete` found gaps; the body carries `missing: [partNumber…]`. Re-send those parts, then `complete` again. Not a restart. |
| `invalid_parts` | 422 | At `complete`: part sizes break the rules, S3 holds parts beyond `partCount` (body carries `extra: [partNumber…]`), the parts don't add up to `fileSize` (body carries `uploadedBytes` and `fileSize`) — completing would store a truncated file — or S3 refused the part list. Start again (restart budget). |
| `invalid_request` | 422 | The request failed validation; `message` names the field. On these routes: `fileSize` over the 10 GiB book ceiling, `partSize` outside 5 MiB–5 GiB, a part number above 2,048, more than 32 part URLs, or a missing field. The same request can never succeed: fix it rather than restart or retry — for an oversized book, tell the user it's too large to back up (better: check the size before `start`). |
| — | 500 | Unexpected failure. Retry with backoff. |

Part PUTs go straight to S3: a 403 means the URL expired (ask for a new one), a 404 `NoSuchUpload` means start over,
and a 400 `RequestTimeout` or any 5xx means retry the part.

## Retrying `complete`

`complete` is safe to repeat. If the upload is gone but the object exists (a previous attempt succeeded and its
response was lost), it answers success and makes sure the row is synced. `start` does the same: if the object already
exists, it answers `exists` instead of opening a second upload.

## The missing-items pass

`POST /v1/library/status` answers, for the uuids in a client's local library, what the server lacks. It exists for an
account that signs in over a library built while signed out, whose sync lapsed and came back, or that moved from LITE
to PRO: items added while sync was off (and uploads the lapse cleared from the queue) never reached the server, and
books registered on LITE have no file.
Open to PRO and LITE.

| Body | Success |
|---|---|
| `{ uuids: [uuid…] }`: every item in the local library (books, folders, bound books), in one request | `{ unknown: [uuid…], unsynced: [uuid…] }` |

- `unknown`: no row has the uuid, active or deleted. First send those items through `POST /uuids`
  (`{ items: { "<key>": "<uuid>" } }`, at most 1,000 per request):
  the server's row may already sit at that key under no uuid (a legacy row) or another one (the same file imported
  on two devices), and `PUT /` at an occupied key answers with that row without storing the client's uuid, so the
  item would come back `unknown` every run and its bookmarks and external resources would answer `item_not_found`.
  `/uuids` sets the uuid on a legacy row and answers a conflict for the other case (adopt the server's uuid). Then
  register each one like an import (`PUT /` at its local path, then its external resources and bookmarks), parents
  before children. No row holds the uuid, so the `PUT` can't move anything, and a deleted item keeps its uuid, so a
  book deleted on another device isn't registered again. On PRO the `PUT`'s answer then asks for the file as usual.
  The one exception (accepted): an item from before the server had uuids (March 2026) that another device deleted
  under its own uuid, or none, before this device's uuid was matched, reads as `unknown` and comes back. `/uuids`
  only looks at active rows, so nothing tells it apart from a book imported on this device.
- `unsynced`: an active book with no file in S3. PRO only: upload its file through `/upload/*`, which finds the book by
  uuid wherever it now lives. Never re-register these: a `PUT /` at a stale path would move them. Skip books streamed
  from a media server (their file arrives when they're downloaded), books with no local file, books over 10 GiB, and
  books with an upload already queued. LITE ignores this list: LITE never uploads, so every book it registered is
  on it.
- Uuids come back spelled as they were sent, once each; strings that aren't uuids are left out of both lists. A
  failed read is a 500, never an empty answer, which would read as "register everything".
- The body is the whole library, so the JSON limit is 5 MB (about 130k uuids). Nothing is capped per request.
- Run it as the registration step of the first sync (after sign-in, and on coming back from a lapse, which a
  client treats as a first sync), on LITE → PRO, and weekly, and only when nothing is waiting in the client's own
  sync queue: a queued import would otherwise come back `unknown` and be registered twice.
- Until that first sync has run, no listing may delete local items it doesn't show (the first sync's own listing
  included): they may be exactly the items the pass is about to register, such as books imported while sync was off.

