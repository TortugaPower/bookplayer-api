import { logger } from './LoggerService';
import { StorageService } from './StorageService';
import { LibraryDB } from './db/LibraryDB';
import { GlacierRestoreDB, RestoreRequestKind } from './db/GlacierRestoreDB';
import { LibraryItemDB, LibraryItemType, StorageState, User } from '../types/user';

/**
 * On-demand thaw of a Pro user's files out of Deep Archive.
 *
 * A lapsed subscription archives a user's whole prefix (GlacierMigrationService);
 * nothing un-archives it when they come back. Instead of restoring libraries
 * eagerly — most of a returner's books are never played again — this runs at the
 * one moment intent is known: when a client asks for the signed URL of ONE item it
 * is about to play or download. The file is checked with a HEAD; if it is in
 * Deep Archive with no thaw in flight, a Standard-tier restore (~12 h) is
 * requested and recorded in `glacier_restore_requests`, which the
 * glacier-cleanup Lambda later turns into a permanent Intelligent-Tiering copy.
 *
 * Rules:
 * - Never fails a request. Every S3 or DB problem is logged and swallowed; the
 *   presigned URL is returned exactly as it would have been.
 * - Only the tapped item's own HEAD happens before the response. Its artwork and,
 *   for a bound book, every sibling file are restored in the background: one
 *   failed chapter brings the whole book back, without adding latency.
 * - The restore window is long (RESTORE_DAYS) on purpose: until the Lambda makes
 *   the copy permanent, the thawed copy is what keeps the book playable, and the
 *   window costs nothing once the copy exists.
 */
export const RESTORE_TIER = 'Standard' as const;
export const RESTORE_DAYS = 30;
// Bound books are folders of files; CD rips run to a thousand tracks. A HEAD per
// file is a fraction of a cent, so no product cap — only a sanity ceiling.
const SIBLING_CEILING = 5000;
const CONCURRENCY = 10;

const ARCHIVED_CLASSES = new Set(['DEEP_ARCHIVE', 'GLACIER']);

export class GlacierRestoreService {
  private readonly _logger = logger;
  /** Background work in flight — awaited by tests, never by request handlers. */
  private _background = new Set<Promise<void>>();
  /**
   * Bound-book walks in flight, keyed `${user_id}:${parentKey}`. Two chapters of
   * the same frozen book tapped within the same second would both see
   * `restore: 'none'` (S3 has not reflected the first request yet) and both
   * start a walk; the second is pure duplicate HEADs, so it is skipped.
   */
  private _walking = new Set<string>();

  constructor(
    private _storage: StorageService = new StorageService(),
    private _libraryDB: LibraryDB = new LibraryDB(),
    private _restoreDB: GlacierRestoreDB = new GlacierRestoreDB(),
  ) {}

  /**
   * Make the one item a client is about to open retrievable. Returns the state
   * to report on that item, or undefined when the object could not be checked
   * (missing, or the probe failed) — in which case nothing is reported and the
   * URL goes out unchanged.
   *
   * Background work — the item's artwork and, for a bound book, its sibling
   * files — starts only when THIS call found the object frozen and requested
   * its thaw. A warm book costs exactly one HEAD, and the taps that follow
   * during a thaw (the object is already `ongoing`) do not re-walk the book.
   */
  async ensureRetrievable(
    user: User,
    item: LibraryItemDB,
    storagePrefix: string,
  ): Promise<StorageState | undefined> {
    try {
      const type = parseInt(`${item.type}`);
      if (type === parseInt(LibraryItemType.BOUND)) {
        // The container has no object of its own. Probe one of its files; if
        // that one is frozen, the whole book is (the lifecycle rule archived the
        // prefix), so restore the rest.
        this.inBackground(this.expandBoundBook(user, item, storagePrefix, null));
        return undefined;
      }
      // Anything that is not a container is a file — including legacy rows whose
      // `type` is NULL, which get a URL like any book and would 403 forever if
      // frozen. Same positive classification LibraryService.getLibrary uses.
      if (type === parseInt(LibraryItemType.FOLDER)) return undefined;

      const outcome = await this.ensureObject(
        user,
        item,
        `${storagePrefix}/${item.source_path || item.key}`,
        'object',
      );
      if (outcome.issued) {
        if (item.thumbnail) {
          this.inBackground(
            this.ensureObject(user, item, `${storagePrefix}_thumbnail/${item.thumbnail}`, 'thumbnail'),
          );
        }
        this.inBackground(this.expandBoundBook(user, item, storagePrefix, item));
      }
      return outcome.state;
    } catch (err) {
      // The hook must never fail a request: the URL goes out as it always has.
      this._logger.log(
        {
          origin: 'GlacierRestoreService.ensureRetrievable',
          message: err?.message ?? String(err),
          data: { user_id: user.id_user, id_library_item: item.id_library_item },
        },
        'warn',
      );
      return undefined;
    }
  }

  /** Awaits every background restore started so far. For tests. */
  async drain(): Promise<void> {
    while (this._background.size) {
      await Promise.all([...this._background]);
    }
  }

  private inBackground(work: Promise<unknown>): void {
    const tracked: Promise<void> = work
      .then(() => undefined)
      .catch((err) => {
        this._logger.log(
          { origin: 'GlacierRestoreService.background', message: err?.message ?? String(err) },
          'warn',
        );
      })
      .finally(() => {
        this._background.delete(tracked);
      });
    this._background.add(tracked);
  }

  /**
   * HEAD one object; request its thaw if it is archived and nothing is thawing
   * it. Every archived object that is thawing or already thawed is recorded, so
   * the Lambda finalizes restores started by hand too — a READY copy that is not
   * recorded would silently refreeze when its window closes.
   *
   * `issued` is true only when this call sent the RestoreObject — the signal
   * that this is the first tap on a frozen object.
   */
  private async ensureObject(
    user: User,
    item: LibraryItemDB,
    key: string,
    kind: RestoreRequestKind,
  ): Promise<{ state: StorageState | undefined; issued: boolean }> {
    const head = await this._storage.headObject({ key });
    if (head === null || head === 'missing') return { state: undefined, issued: false };
    if (!ARCHIVED_CLASSES.has(head.storageClass ?? '')) return { state: 'available', issued: false };

    let issued = false;
    if (head.restore === 'none') {
      const requested = await this._storage.restoreObject({
        key,
        days: RESTORE_DAYS,
        tier: RESTORE_TIER,
      });
      if (requested === null) return { state: undefined, issued: false };
      issued = true;
    }
    await this._restoreDB.upsertRequested({
      user_id: user.id_user,
      library_item_id: item.id_library_item ?? null,
      kind,
      key,
      tier: RESTORE_TIER,
      days: RESTORE_DAYS,
    });
    return { state: head.restore === 'ready' ? 'available' : 'restoring', issued };
  }

  /**
   * Restore every other file of the bound book `item` belongs to (or is, when
   * `tapped` is null and `item` is the container). A bound book streams chapter
   * by chapter, so restoring only the tapped file would cost the user a 12 h
   * wait per chapter. For a container, a file is probed first and the walk
   * stops there unless it is frozen: a warm bound book costs one HEAD.
   */
  private async expandBoundBook(
    user: User,
    item: LibraryItemDB,
    storagePrefix: string,
    tapped: LibraryItemDB | null,
  ): Promise<void> {
    const type = parseInt(`${item.type}`);
    let parent: LibraryItemDB | null = null;
    if (type === parseInt(LibraryItemType.BOUND)) {
      parent = item;
    } else if (type !== parseInt(LibraryItemType.FOLDER)) {
      const cut = item.key.lastIndexOf('/');
      if (cut > 0) {
        const candidate = (
          await this._libraryDB.getLibrary(user.id_user, item.key.slice(0, cut), { exactly: true })
        )?.[0];
        if (candidate && parseInt(`${candidate.type}`) === parseInt(LibraryItemType.BOUND)) {
          parent = candidate;
        }
      }
    }
    if (!parent) return;
    const walkKey = `${user.id_user}:${parent.key}`;
    if (this._walking.has(walkKey)) return;
    this._walking.add(walkKey);
    try {
      await this.walkBoundBook(user, parent, storagePrefix, tapped);
    } finally {
      this._walking.delete(walkKey);
    }
  }

  /** How many files a container tap will HEAD looking for a definitive answer before giving up. */
  private static readonly PROBE_ATTEMPTS = 3;

  private async walkBoundBook(
    user: User,
    parent: LibraryItemDB,
    storagePrefix: string,
    tapped: LibraryItemDB | null,
  ): Promise<void> {
    const children = (await this._libraryDB.getLibrary(user.id_user, `${parent.key}/`)) ?? [];
    const isContainer = (row: LibraryItemDB) => {
      const t = parseInt(`${row.type}`);
      return t === parseInt(LibraryItemType.FOLDER) || t === parseInt(LibraryItemType.BOUND);
    };
    const files = children.filter(
      (child) => !isContainer(child) && child.id_library_item !== tapped?.id_library_item,
    );
    const keyOf = (file: LibraryItemDB) => `${storagePrefix}/${file.source_path || file.key}`;

    let queue = files;
    if (!tapped) {
      // Container tapped: probe before walking. Files whose object cannot be
      // checked (unsynced, 404, failed HEAD) say nothing about the book, so try
      // the next one — synced files first — and stop on any definitive answer.
      const candidates = [...files].sort((a, b) => Number(b.synced) - Number(a.synced));
      let issued = false;
      const probed = new Set<number>();
      for (const probe of candidates.slice(0, GlacierRestoreService.PROBE_ATTEMPTS)) {
        probed.add(probe.id_library_item);
        const outcome = await this.ensureObject(user, probe, keyOf(probe), 'object');
        if (outcome.issued) {
          issued = true;
          break;
        }
        if (outcome.state !== undefined) return; // warm, thawing or ready: not a fresh freeze
      }
      if (!issued) return;
      queue = files.filter((file) => !probed.has(file.id_library_item));
    }

    // The book's own cover lives on the container row, not on any chapter —
    // before the empty check, so a one-chapter book gets its cover too.
    if (parent.thumbnail) {
      await this.ensureObject(user, parent, `${storagePrefix}_thumbnail/${parent.thumbnail}`, 'thumbnail');
    }
    if (!queue.length) return;

    if (queue.length > SIBLING_CEILING) {
      this._logger.log(
        {
          origin: 'GlacierRestoreService.walkBoundBook',
          message: `Bound book has ${queue.length} files; restoring the first ${SIBLING_CEILING}`,
          data: { user_id: user.id_user, id_library_item: parent.id_library_item },
        },
        'warn',
      );
      queue = queue.slice(0, SIBLING_CEILING);
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await this.ensureObject(user, next, keyOf(next), 'object');
        } catch (err) {
          this._logger.log(
            {
              origin: 'GlacierRestoreService.walkBoundBook',
              message: err?.message ?? String(err),
              data: { user_id: user.id_user, id_library_item: next.id_library_item },
            },
            'warn',
          );
        }
      }
    });
    await Promise.all(workers);
  }
}
