import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// Mock the DB layer so middleware tests never touch Postgres. Hoisted above the
// middleware import, so the module-scope `new SyncAuditDB()` gets the mock.
jest.mock('../../services/db/SyncAuditDB');

import { SyncAuditDB } from '../../services/db/SyncAuditDB';
import {
  recordSyncOperation,
  jobTypeFor,
  isProgressOnlyUpdate,
  extractMessage,
  sanitizeParams,
} from '../../api/middlewares/recordSyncOperation';
import {
  SyncOperationJobType,
  SyncOperationRecord,
} from '../../types/syncOperation';

describe('recordSyncOperation helpers', () => {
  describe('jobTypeFor', () => {
    it('maps mutating routes to their job type', () => {
      expect(jobTypeFor({ method: 'PUT', route: { path: '/' } })).toBe(
        SyncOperationJobType.UPLOAD,
      );
      expect(jobTypeFor({ method: 'POST', route: { path: '/' } })).toBe(
        SyncOperationJobType.UPDATE,
      );
      expect(
        jobTypeFor({ method: 'POST', route: { path: '/thumbnail_set' } }),
      ).toBe(SyncOperationJobType.UPLOAD_ARTWORK);
      expect(jobTypeFor({ method: 'POST', route: { path: '/move' } })).toBe(
        SyncOperationJobType.MOVE,
      );
      expect(jobTypeFor({ method: 'DELETE', route: { path: '/' } })).toBe(
        SyncOperationJobType.DELETE,
      );
    });

    it('returns undefined for reads and unmapped/unmatched routes', () => {
      // GET reads are not in the map
      expect(jobTypeFor({ method: 'GET', route: { path: '/' } })).toBeUndefined();
      // POST /bookmarks is a read, deliberately absent
      expect(
        jobTypeFor({ method: 'POST', route: { path: '/bookmarks' } }),
      ).toBeUndefined();
      // no matched route (e.g. 404) -> no req.route
      expect(jobTypeFor({ method: 'POST' })).toBeUndefined();
    });
  });

  describe('isProgressOnlyUpdate', () => {
    it('treats identifier + playback-only bodies as progress-only', () => {
      // mirrors the real client update body observed in prod (includes `id`)
      expect(
        isProgressOnlyUpdate({
          relativePath: 'Book',
          id: 123,
          uuid: 'abc',
          currentTime: 42,
          percentCompleted: 10,
          lastPlayDateTimestamp: 123,
        }),
      ).toBe(true);
      // originalFileName is an identifier the update handler ignores
      expect(
        isProgressOnlyUpdate({ relativePath: 'Book', originalFileName: 'Book', currentTime: 1 }),
      ).toBe(true);
      // an empty body is a no-op -> dropped
      expect(isProgressOnlyUpdate({})).toBe(true);
    });

    it('logs updates that touch any structural field', () => {
      expect(isProgressOnlyUpdate({ relativePath: 'Book', title: 'New Title' })).toBe(false);
      expect(isProgressOnlyUpdate({ relativePath: 'Book', orderRank: 3 })).toBe(false);
      expect(isProgressOnlyUpdate({ relativePath: 'Book', details: 'author' })).toBe(false);
    });

    it('does not treat a non-object as progress-only', () => {
      expect(isProgressOnlyUpdate(undefined)).toBe(false);
      expect(isProgressOnlyUpdate('nope')).toBe(false);
    });
  });

  describe('extractMessage', () => {
    it('pulls .message from a stringified JSON error body (the real Express path)', () => {
      expect(
        extractMessage('{"status":400,"message":"Item not exists"}'),
      ).toBe('Item not exists');
    });

    it('pulls .message from an object body (fallback path)', () => {
      expect(extractMessage({ status: 400, message: 'Duplicate key' })).toBe(
        'Duplicate key',
      );
    });

    it('returns a plain non-JSON string as-is', () => {
      expect(extractMessage('boom')).toBe('boom');
    });

    it('returns null when there is no message', () => {
      expect(extractMessage(undefined)).toBeNull();
      expect(extractMessage({ foo: 'bar' })).toBeNull();
    });

    it('truncates to 512 chars', () => {
      const long = 'x'.repeat(600);
      expect(extractMessage(long)!.length).toBe(512);
    });
  });

  describe('sanitizeParams', () => {
    it('drops note/title for set_bookmark without mutating the original body', () => {
      const body = { relativePath: 'Book', time: 5, note: 'secret', title: 'chapter' };
      const out = sanitizeParams(SyncOperationJobType.SET_BOOKMARK, body) as Record<
        string,
        unknown
      >;
      expect(out).toEqual({ relativePath: 'Book', time: 5 });
      // original untouched
      expect(body.note).toBe('secret');
      expect(body.title).toBe('chapter');
    });

    it('passes non-bookmark bodies through under the size cap', () => {
      const body = { relativePath: 'Book', title: 'New' };
      expect(sanitizeParams(SyncOperationJobType.UPDATE, body)).toBe(body);
    });

    it('replaces an oversized body with a size marker', () => {
      const body = { relativePath: 'Book', blob: 'z'.repeat(9000) };
      const out = sanitizeParams(SyncOperationJobType.UPLOAD, body) as {
        _truncated: boolean;
        _bytes: number;
      };
      expect(out._truncated).toBe(true);
      expect(out._bytes).toBeGreaterThan(8192);
    });

    it('handles null / non-object bodies', () => {
      expect(sanitizeParams(SyncOperationJobType.UPLOAD, null)).toBeNull();
    });
  });
});

describe('recordSyncOperation middleware', () => {
  const OLD_FLAG = process.env.SYNC_AUDIT_ENABLED;

  // The middleware built its SyncAuditDB at import time; grab that instance's
  // mocked record().
  function recordMock(): jest.Mock {
    const instances = (SyncAuditDB as unknown as jest.Mock).mock.instances;
    return (instances[0] as any).record as jest.Mock;
  }

  function makeRes() {
    const res: any = {
      statusCode: 200,
      locals: {},
      _finish: null as null | (() => void),
      json(body: unknown) {
        this._lastBody = body;
        return this;
      },
      send(body: unknown) {
        this._lastBody = body;
        return this;
      },
      on(event: string, cb: () => void) {
        if (event === 'finish') this._finish = cb;
        return this;
      },
      emitFinish() {
        this._finish && this._finish();
      },
    };
    return res;
  }

  beforeEach(() => {
    process.env.SYNC_AUDIT_ENABLED = 'true';
    recordMock().mockClear();
  });

  afterEach(() => {
    process.env.SYNC_AUDIT_ENABLED = OLD_FLAG;
  });

  it('records a successful structural mutation as applied', () => {
    const req: any = {
      method: 'POST',
      path: '/rename',
      route: { path: '/rename' },
      user: { id_user: 7 },
      body: { relativePath: 'Old', newName: 'New', uuid: 'not-a-uuid' },
      app_version: '2023-10-29',
    };
    const res = makeRes();
    const next = jest.fn();

    recordSyncOperation(req, res, next);
    expect(next).toHaveBeenCalled();

    res.statusCode = 200;
    res.json({ content: { url: null } });
    res.emitFinish();

    expect(recordMock()).toHaveBeenCalledTimes(1);
    const arg = recordMock().mock.calls[0][0] as SyncOperationRecord;
    expect(arg.outcome).toBe('applied');
    expect(arg.job_type).toBe(SyncOperationJobType.RENAME);
    expect(arg.user_id).toBe(7);
    // malformed uuid is dropped to null (would otherwise crash the insert)
    expect(arg.item_uuid).toBeNull();
  });

  it('truncates app_version to the column width (varchar(16))', () => {
    const req: any = {
      method: 'POST',
      path: '/move',
      route: { path: '/move' },
      user: { id_user: 7 },
      body: { origin: 'a', destination: 'b' },
      app_version: 'x'.repeat(40),
    };
    const res = makeRes();
    recordSyncOperation(req, res, jest.fn());
    res.statusCode = 200;
    res.json({});
    res.emitFinish();

    const arg = recordMock().mock.calls[0][0] as SyncOperationRecord;
    expect(arg.app_version).toHaveLength(16);
  });

  it('records a failed op as error with the extracted message', () => {
    const req: any = {
      method: 'POST',
      path: '/thumbnail_set',
      route: { path: '/thumbnail_set' },
      user: { id_user: 7 },
      body: { relativePath: 'Book', uuid: '336453c8-24e3-4298-9e8c-8b41f70ac4e7' },
    };
    const res = makeRes();
    recordSyncOperation(req, res, jest.fn());

    res.statusCode = 400;
    // global error handler sends the body through res.send(stringified)
    res.send('{"status":400,"message":"Item not exists"}');
    res.emitFinish();

    const arg = recordMock().mock.calls[0][0] as SyncOperationRecord;
    expect(arg.outcome).toBe('error');
    expect(arg.error_message).toBe('Item not exists');
    expect(arg.item_uuid).toBe('336453c8-24e3-4298-9e8c-8b41f70ac4e7');
  });

  it('does not record reads', () => {
    const req: any = {
      method: 'GET',
      path: '/',
      route: { path: '/' },
      user: { id_user: 7 },
      body: {},
    };
    const res = makeRes();
    recordSyncOperation(req, res, jest.fn());
    res.json({ content: [] });
    res.emitFinish();
    expect(recordMock()).not.toHaveBeenCalled();
  });

  it('does not record playback-only updates', () => {
    const req: any = {
      method: 'POST',
      path: '/',
      route: { path: '/' },
      user: { id_user: 7 },
      body: { relativePath: 'Book', id: 99, currentTime: 42, percentCompleted: 10 },
    };
    const res = makeRes();
    recordSyncOperation(req, res, jest.fn());
    res.json({ content: { url: null } });
    res.emitFinish();
    expect(recordMock()).not.toHaveBeenCalled();
  });

  it('does not record when unauthenticated', () => {
    const req: any = {
      method: 'POST',
      path: '/move',
      route: { path: '/move' },
      user: undefined,
      body: { origin: 'a', destination: 'b' },
    };
    const res = makeRes();
    recordSyncOperation(req, res, jest.fn());
    res.emitFinish();
    expect(recordMock()).not.toHaveBeenCalled();
  });

  it('is inert (no wrapping, no record) when the flag is off', () => {
    process.env.SYNC_AUDIT_ENABLED = 'false';
    const req: any = {
      method: 'POST',
      path: '/move',
      route: { path: '/move' },
      user: { id_user: 7 },
      body: { origin: 'a', destination: 'b' },
    };
    const res = makeRes();
    const next = jest.fn();
    recordSyncOperation(req, res, next);
    expect(next).toHaveBeenCalled();
    // finish was never registered because the middleware returned early
    expect(res._finish).toBeNull();
    res.emitFinish();
    expect(recordMock()).not.toHaveBeenCalled();
  });
});
