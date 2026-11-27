# Same-name merges

Two items that arrive at the same key are one item. This doc is the rule the server applies when that
happens, why, and how it ships.

## The problem

Library rows are unique on `(user_id, key)` among active rows, and the key is the item's path. When a
client uploads an item to a key another item already holds (`PUT /`), `putObject` answers 200 with the row
that is already there and drops the client's uuid. Neither app reads the uuid in that reply, so the app
keeps an id the server has never stored, and its next request by that id (`/move` by uuid, most often)
gets `item_not_found`. Both apps hold the sync queue behind it: older versions retry it every 5 seconds,
6.0.x pauses the lane until the next launch or Retry.

It happens when the same book, or a same-named folder, is added on two devices before either has synced:
one customer made a series' first part into a bound book on one device, and into a folder with the same
name on their phone 5 minutes later.
In the 30 days to 2026-11-25, about 10 customers were stuck on exactly this (`sync_operations`: an
applied `upload` whose uuid never got a row, while another uuid holds the key).

Moves and renames clash too, with the opposite outcome: `rewriteKeyPrefix` lets the moving item win and
switches the occupant off with its uuid erased (`collisionWinner: 'mover'`), which can strand whichever
device still holds the erased uuid the same way.

## The rule

Decided with the maintainer on 2026-11-25 and 2026-11-26.

- **The item already at the key survives and keeps its uuid.** Other devices already know it, so only the
  device that caused the clash has to change, and it is online and getting the reply.
- **The arriving item's uuid becomes a pointer to the survivor**, kept permanently in
  `library_item_merges`. Anything still naming it (tasks queued before the merge, another device, an app
  version that ignores the merge, bookmarks) lands on the merged item.
- **Containers merge their contents.** The arriving folder's or bound book's children move into the
  survivor; a child that clashes goes through the same rule one level down.
- **Files:** the survivor keeps its file; if it has none yet, it takes the arriving item's. When both have
  one, the arriving copy's S3 object is deleted. A wrong merge (two different books with a generic name
  such as `Audiobook/Track 01.mp3`) therefore can't be undone; accepted on 2026-11-26.
- **Progress:** the most recently played position wins, the rule `withoutStaleProgress` already applies
  between devices.
- **Bookmarks:** both items' bookmarks are kept on the survivor.
- **Replies list the merges** (`your uuid X is now Y`), and the apps switch to the survivor's uuid.
- **A book and a container never merge.** They can't be one item, so that clash stays an error. The one
  case seen (October 2026) came from a single device making a folder named exactly like a file and moving
  the file into it; it goes away with uuid-based placement (items pointing at their parent's uuid instead
  of being keyed by path), not with a stopgap here.

## Pointers

`library_item_merges (user_id, merged_uuid, into_item_id, created_at)`, primary key
`(user_id, merged_uuid)`.

- `into_item_id` is the survivor's row id, never its uuid: a row id doesn't change, a uuid can.
- One hop: when a survivor is later merged into another item, the pointers into it move to the new
  survivor in the same transaction (indexed by `library_item_merges_into`).
- No foreign keys: adding one locks `library_items` or `users` while the deploy's migration runs, and
  neither table's rows are ever hard-deleted. A pointer to a missing row resolves to nothing.

A pointer is only ever recorded for a uuid with no active row of its own, so a lookup finds the uuid's own
row when it has one and the survivor otherwise:

| Lookup | With a pointer |
|---|---|
| `LibraryDB.getLibraryByUuid` | Returns the survivor. Covers every caller: `GET /` for an item or a container's contents, move origin and destination, rename, `folder_in_out`, the `synced` guard and the late-progress check on `POST /`, upload-as-move, the multipart upload target, setting a bookmark, `thumbnail_set`, and linking and unlinking external resources |
| `LibraryDB.updateLibraryItem` (`POST /` by uuid) | When no row has the uuid, the update applies to the survivor, so a merged device's progress isn't dropped (looked up only on that miss: progress updates keep one statement) |
| `LibraryDB.deleteLibraryByUuid` (`DELETE /` by uuid) | Deletes the survivor, instead of answering success with nothing deleted and the item coming back on the device's next download |
| `LibraryDB.hasDeletedItem` (by uuid) | A merged uuid counts as deleted when its survivor was deleted, so the request gets the usual "already deleted, nothing to do" answer instead of `item_not_found` |
| `LibraryDB.getBookmarks` (by uuid) | Returns the survivor's bookmarks |
| `LibraryDB.getItemsByUuids` (`/status`) | **Not followed, on purpose.** A merged uuid stays `unknown`, and both apps' missing-items pass reacts by matching the item by path and taking the survivor's uuid, so apps that never read a merge reply still switch over |

Support can unstick a customer by hand with one insert, without changing any row another device relies
on:

```sql
INSERT INTO library_item_merges (user_id, merged_uuid, into_item_id)
VALUES (<user_id>, '<the uuid the app is stuck on, lowercase>', <id_library_item of the row at that key>);
```

## How it ships

1. **Pointers and lookups** (this change): the table, and the lookups, update and delete above following
   pointers. Nothing writes pointers yet, so nothing changes until one is inserted.
2. **Upload and uuid matching record merges:** `PUT /` on a same-kind row with another uuid records a
   pointer and lists the merge in its reply; on a book-vs-container clash it answers `uuid_conflict` (409)
   instead of today's 200 that turns into a 404 later. `POST /uuids` conflicts record a pointer too.
3. **One rule for key rewrites:** move, rename, `folder_in_out` and upload-as-move stop choosing a
   `collisionWinner`; a clash becomes a merge into the occupant, applying the rule above.
4. **Backfill:** pointers for clashes that happened before step 2, found in `sync_operations`.
5. **Apps:** iOS and Android adopt the survivor's uuid from each reply that lists a merge.

## Open questions

None.
