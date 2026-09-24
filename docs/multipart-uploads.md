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
  streamed in from a media server (Jellyfin, Audiobookshelf), it also marks the item's external resources
  `downloaded`: these routes are the only way a media-server book's file reaches S3.
- **`synced` means the file is in S3, on every tier.** `PUT /` creates rows unsynced, and `POST /` ignores
  `synced:true` for a book with no object. So `GET /keys`, which lists synced rows, is "books whose file is in S3":
  a LITE account's books are left out of it on purpose, because LITE never uploads a file. Clients use `/keys` only
  for the one-off "upload what the server is missing" pass (iOS: an install's first sync; Android: a tier change),
  and should run that pass only on PRO.
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
| `POST /start` | `{ uuid, fileSize, partSize }` | `{ status: "started", uploadId, partSize, partCount }`, or `{ status: "exists" }` when the object is already in S3 (the row is marked synced) |
| `POST /parts` | `{ uuid, uploadId, partNumbers }` (1–32 distinct part numbers; duplicates are ignored) | `{ parts: [{ partNumber, url, expiresAt }] }` |
| `GET /parts` | `?uuid=&uploadId=` | `{ parts: [{ partNumber, size }] }` |
| `POST /complete` | `{ uuid, uploadId, partCount, fileSize }` (`fileSize` read from the file on disk) | `{ synced: true }` |
| `POST /abort` | `{ uuid, uploadId }` | `{ aborted: true }` (also when already gone) |

Constraints: a book is at most **10 GiB** (a product ceiling; the longest known audiobook is ~1.7 GiB at 64 kbps and
~6.7 GiB at 256 kbps), so no part number is above 2,048. From S3: `partSize` between 5 MiB and 5 GiB, every part but the
last exactly `partSize`. The client PUTs each part's bytes to its URL with no extra headers (the signature covers `host` only).
`expiresAt` is a unix timestamp, but treat it as an upper bound: task-role credentials can end a URL sooner.

## Errors

Every error body is `{ message, code? }`. Branch on `code`, never on `message`.

| code | HTTP | Client action |
|---|---|---|
| `item_not_found` | 404 | No active book with that uuid. If the book still exists locally, re-register it through the sync lane; otherwise drop the upload. |
| `upload_not_found` | 409 | S3 no longer has the upload (aborted or reclaimed). Forget the `uploadId` and `start` again. Counts against the restart budget. |
| `parts_missing` | 409 | `complete` found gaps; the body carries `missing: [partNumber…]`. Re-send those parts, then `complete` again. Not a restart. |
| `invalid_parts` | 422 | At `complete`: part sizes break the rules, S3 holds parts beyond `partCount` (body carries `extra: [partNumber…]`), the parts don't add up to `fileSize` (body carries `uploadedBytes` and `fileSize`) — completing would store a truncated file — or S3 refused the part list. Start again (restart budget). |
| `invalid_request` | 422 | At `start`, `POST /parts` or `complete`: `fileSize` over the 10 GiB book ceiling (at `complete` the upload is also aborted), `partSize` outside 5 MiB–5 GiB, a part number above 2,048, or more than 32 part URLs asked for. The same request can never succeed: fix it rather than restart or retry — for an oversized book, tell the user it's too large to back up. |
| — | 422 | Body validation failed (`message` says which field). A client bug; do not retry unchanged. |
| — | 500 | Unexpected failure. Retry with backoff. |

Part PUTs go straight to S3: a 403 means the URL expired (ask for a new one), a 404 `NoSuchUpload` means start over,
and a 400 `RequestTimeout` or any 5xx means retry the part.

## Retrying `complete`

`complete` is safe to repeat. If the upload is gone but the object exists (a previous attempt succeeded and its
response was lost), it answers success and makes sure the row is synced. `start` does the same: if the object already
exists, it answers `exists` instead of opening a second upload.
