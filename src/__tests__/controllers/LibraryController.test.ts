import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryController } from '../../controllers/LibraryController';
import { ITEM_DELETED, LibraryLookupError } from '../../services/LibraryService';
import { ApiError, ApiErrorCode } from '../../types/apiError';
import { mockLoggerService } from '../setup';

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Sync clients reconcile deletions against a contents listing, so a failed
// read must never look like an empty library, and it must read as retryable
// (5xx) rather than as a client mistake (4xx).
describe('LibraryController.getLibraryContentPath — error mapping', () => {
  let libraryService: any;
  let controller: LibraryController;

  beforeEach(() => {
    libraryService = {
      getLibrary: jest.fn(),
      getLastItemPlayed: jest.fn(),
    };
    controller = new LibraryController(libraryService, {} as any);
    (controller as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const request = () =>
    ({
      query: { relativePath: 'Folder/', sign: 'true' },
      user: { id_user: 1, email: 'user@example.com' },
      app_version: '2022-12-12',
    }) as any;

  it('answers a generic 500 when the lookup itself failed — never a message that reads as data loss', async () => {
    libraryService.getLibrary.mockRejectedValue(new LibraryLookupError());
    const res = makeRes();

    await controller.getLibraryContentPath(request(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
    // Logged with identifiers only — never the user object (email, subscriptions).
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { user_id: 1, query: { relativePath: 'Folder/', sign: 'true' } },
      }),
      'error',
    );
    expect(JSON.stringify(mockLoggerService.log.mock.calls)).not.toContain('user@example.com');
  });

  it('answers 500 "Internal error" for any other thrown failure (presign, prefix, driver)', async () => {
    libraryService.getLibrary.mockRejectedValue(new Error('boom'));
    const res = makeRes();

    await controller.getLibraryContentPath(request(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
    // The raw message is logged, not sent to the client.
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      'error',
    );
  });

  it('rejects array-shaped query parameters with 422 before touching the service', async () => {
    const malformed: Array<Record<string, unknown>> = [
      { relativePath: 'Folder/', uuid: ['11111111-1111-4111-8111-111111111111'] },
      { relativePath: ['Folder/'] },
    ];
    for (const query of malformed) {
      const res = makeRes();
      const req = { ...request(), query };

      await controller.getLibraryContentPath(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid query parameters' });
    }
    expect(libraryService.getLibrary).not.toHaveBeenCalled();
  });

  it('parses the sign flag as a boolean: "false" and "0" do not presign', async () => {
    libraryService.getLibrary.mockResolvedValue([]);
    for (const [sign, expected] of [['true', true], ['1', true], ['false', false], ['0', false], [undefined, false]] as const) {
      libraryService.getLibrary.mockClear();
      const req = request();
      req.query = { relativePath: 'Folder/', ...(sign === undefined ? {} : { sign }) };

      await controller.getLibraryContentPath(req, makeRes());

      expect(libraryService.getLibrary.mock.calls[0][2].withPresign).toBe(expected);
    }
  });

  it('noLastItemPlayed=true skips the resume item on the root listing', async () => {
    libraryService.getLibrary.mockResolvedValue([]);
    const req = request();
    req.query = { relativePath: '', sign: 'true', noLastItemPlayed: 'true' };

    await controller.getLibraryContentPath(req, makeRes());

    expect(libraryService.getLastItemPlayed).not.toHaveBeenCalled();
  });

  it('returns the listing on success without touching the status', async () => {
    libraryService.getLibrary.mockResolvedValue([{ relativePath: 'Folder/a.m4b' }]);
    const res = makeRes();

    await controller.getLibraryContentPath(request(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ content: [{ relativePath: 'Folder/a.m4b' }] });
  });

  it('keeps the root listing when only the resume item fails, omitting lastItemPlayed', async () => {
    libraryService.getLibrary.mockResolvedValue([{ relativePath: 'a.m4b' }]);
    libraryService.getLastItemPlayed.mockRejectedValue(new LibraryLookupError());
    const res = makeRes();
    const req = request();
    req.query = { relativePath: '', sign: 'true' };

    await controller.getLibraryContentPath(req, res);

    expect(res.status).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.content).toEqual([{ relativePath: 'a.m4b' }]);
    expect(Object.keys(payload)).toEqual(['content']);
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'LibraryController.getLibraryContentPath',
        data: { user_id: 1, step: 'lastItemPlayed' },
      }),
      'error',
    );
  });

  it('sends lastItemPlayed: null on the root listing when nothing has been played', async () => {
    libraryService.getLibrary.mockResolvedValue([]);
    libraryService.getLastItemPlayed.mockResolvedValue(null);
    const res = makeRes();
    const req = request();
    req.query = { relativePath: '', sign: 'true' };

    await controller.getLibraryContentPath(req, res);

    expect(res.json).toHaveBeenCalledWith({ content: [], lastItemPlayed: null });
  });
});

describe('LibraryController.getLastPlayedItem — error mapping mirrors the listing', () => {
  let libraryService: any;
  let controller: LibraryController;

  beforeEach(() => {
    libraryService = { getLastItemPlayed: jest.fn() };
    controller = new LibraryController(libraryService, {} as any);
    (controller as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const request = () =>
    ({ query: { sign: 'true' }, user: { id_user: 1, email: 'user@example.com' }, app_version: '2022-12-12' }) as any;

  it('answers a generic 500 when the lookup failed', async () => {
    libraryService.getLastItemPlayed.mockRejectedValue(new LibraryLookupError());
    const res = makeRes();

    await controller.getLastPlayedItem(request(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
    expect(JSON.stringify(mockLoggerService.log.mock.calls)).not.toContain('user@example.com');
  });

  it('answers 500 "Internal error" for any other thrown failure', async () => {
    libraryService.getLastItemPlayed.mockRejectedValue(new Error('boom'));
    const res = makeRes();

    await controller.getLastPlayedItem(request(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
  });

  it('returns null with a 200 when nothing has been played yet', async () => {
    libraryService.getLastItemPlayed.mockResolvedValue(null);
    const res = makeRes();

    await controller.getLastPlayedItem(request(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ lastItemPlayed: null });
  });
});

// A request naming an item with no active row: deleted → success with nothing
// changed; never existed → 404 `item_not_found`; failed read → 500.
describe('LibraryController — legacy routes naming a missing item', () => {
  let libraryService: any;
  let libraryDB: any;
  let controller: LibraryController;
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const notFound = new ApiError(ApiErrorCode.ITEM_NOT_FOUND, 404, `Item not found: "${uuid}"`);

  beforeEach(() => {
    libraryService = {
      confirmDeleted: jest.fn(async () => true),
      thumbnailPutRequest: jest.fn(),
      renameLibraryObject: jest.fn(),
      deleteFolderMoving: jest.fn(),
      moveLibraryObjectByUuid: jest.fn(),
      putExternalResource: jest.fn(),
      deleteExternalResource: jest.fn(),
    };
    libraryDB = {
      getLibraryByUuid: jest.fn(async () => []),
      getLibrary: jest.fn(async () => []),
      upsertBookmark: jest.fn(),
      deactivateBookmark: jest.fn(),
    };
    controller = new LibraryController(libraryService, libraryDB);
    (controller as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
  });

  const request = (body: Record<string, unknown>) =>
    ({ body, user: { id_user: 1, email: 'user@example.com' } }) as any;

  describe('PUT /bookmark', () => {
    it('answers success, and writes nothing, for a bookmark on a deleted book', async () => {
      const res = makeRes();
      await controller.upsertBookmark(request({ uuid, key: 'Book.m4b', time: 120, active: true }), res);

      expect(libraryService.confirmDeleted).toHaveBeenCalledWith(expect.anything(), { uuid, key: 'Book.m4b' });
      expect(res.json).toHaveBeenCalledWith({ bookmark: null });
      expect(libraryDB.upsertBookmark).not.toHaveBeenCalled();
    });

    it('answers 404 item_not_found for a bookmark on a book that never existed', async () => {
      libraryService.confirmDeleted.mockRejectedValue(notFound);
      const res = makeRes();
      await controller.upsertBookmark(request({ uuid, key: 'Book.m4b', time: 120, active: true }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: notFound.message, error: 'item_not_found' });
    });

    it('treats deleting a bookmark on a missing book as done, deleted or not', async () => {
      const res = makeRes();
      await controller.upsertBookmark(request({ uuid, key: 'Book.m4b', time: 120, active: false }), res);

      expect(libraryService.confirmDeleted).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ bookmark: null });
    });

    it('deletes by deactivating, and answers success for a bookmark the server never had', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValue([{ id_library_item: 9, title: 'Book', key: 'Book.m4b' }]);
      libraryDB.deactivateBookmark.mockResolvedValue(undefined);
      const res = makeRes();
      await controller.upsertBookmark(request({ uuid, key: 'Book.m4b', time: 120, active: false }), res);

      expect(libraryDB.deactivateBookmark).toHaveBeenCalled();
      expect(libraryDB.upsertBookmark).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ bookmark: null });
    });

    it('answers 500 when the item lookup fails', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValue(null);
      const res = makeRes();
      await controller.upsertBookmark(request({ uuid, key: 'Book.m4b', time: 120, active: true }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
    });
  });

  it('POST /rename answers success for a deleted folder and 404 for one that never existed', async () => {
    const res = makeRes();
    await controller.renameLibraryObject(request({ uuid, relativePath: 'Series', newName: 'New' }), res);
    expect(res.json).toHaveBeenCalledWith({ content: [] });
    expect(libraryService.renameLibraryObject).not.toHaveBeenCalled();

    libraryService.confirmDeleted.mockRejectedValue(notFound);
    const res404 = makeRes();
    await controller.renameLibraryObject(request({ uuid, relativePath: 'Series', newName: 'New' }), res404);
    expect(res404.status).toHaveBeenCalledWith(404);
  });

  describe('DELETE /folder_in_out', () => {
    it('treats a missing folder as already removed, deleted or never there', async () => {
      const res = makeRes();
      await controller.deleteFolderMoving(request({ uuid, relativePath: 'Series' }), res);

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(libraryService.confirmDeleted).not.toHaveBeenCalled();
      expect(libraryService.deleteFolderMoving).not.toHaveBeenCalled();
    });

    it('answers 500 when the folder lookup fails', async () => {
      libraryDB.getLibraryByUuid.mockResolvedValue(null);
      const res = makeRes();
      await controller.deleteFolderMoving(request({ uuid, relativePath: 'Series' }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /thumbnail_set', () => {
    it('answers a null URL for a deleted book', async () => {
      libraryService.thumbnailPutRequest.mockResolvedValue(ITEM_DELETED);
      const res = makeRes();
      await controller.itemThumbnailPutRequest(request({ uuid, relativePath: 'Book.m4b', thumbnail_name: 't.jpg' }), res);

      expect(res.json).toHaveBeenCalledWith({ thumbnail_name: 't.jpg', thumbnail_url: null, uploaded: false });
    });

    it('answers 404 item_not_found for a book that never existed', async () => {
      libraryService.thumbnailPutRequest.mockRejectedValue(notFound);
      const res = makeRes();
      await controller.itemThumbnailPutRequest(request({ uuid, relativePath: 'Book.m4b', thumbnail_name: 't.jpg' }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: notFound.message, error: 'item_not_found' });
    });
  });

  describe('external resources', () => {
    it('PUT /external answers an empty content for a deleted book, and 404 for one that never existed', async () => {
      libraryService.putExternalResource.mockResolvedValueOnce(null);
      const res = makeRes();
      await controller.putExternalResource(request({ uuid, providerName: 'jellyfin', providerId: 'p1' }), res);
      expect(res.json).toHaveBeenCalledWith({ content: {} });

      libraryService.putExternalResource.mockRejectedValueOnce(notFound);
      const res404 = makeRes();
      await controller.putExternalResource(request({ uuid, providerName: 'jellyfin', providerId: 'p1' }), res404);
      expect(res404.status).toHaveBeenCalledWith(404);
    });

    it('DELETE /external answers 500 when the lookup fails', async () => {
      libraryService.deleteExternalResource.mockRejectedValue(new LibraryLookupError());
      const res = makeRes();
      await controller.deleteExternalResource(request({ uuid, providerName: 'jellyfin', providerId: 'p1' }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'Internal error' });
    });
  });

  it('POST /move maps a coded error to its status and a failed read to 500', async () => {
    libraryService.moveLibraryObjectByUuid.mockRejectedValueOnce(notFound);
    const res = makeRes();
    await controller.moveLibraryObject(request({ origin: uuid, destination: '' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: notFound.message, error: 'item_not_found' });

    libraryService.moveLibraryObjectByUuid.mockRejectedValueOnce(new LibraryLookupError());
    const res500 = makeRes();
    await controller.moveLibraryObject(request({ origin: uuid, destination: '' }), res500);
    expect(res500.status).toHaveBeenCalledWith(500);

    libraryService.moveLibraryObjectByUuid.mockRejectedValueOnce(new Error('The destination is invalid'));
    const res400 = makeRes();
    await controller.moveLibraryObject(request({ origin: uuid, destination: '' }), res400);
    expect(res400.status).toHaveBeenCalledWith(400);
    expect(res400.json).toHaveBeenCalledWith({ message: 'The destination is invalid' });
  });
});
