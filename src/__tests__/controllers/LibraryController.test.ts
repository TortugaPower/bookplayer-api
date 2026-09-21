import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LibraryController } from '../../controllers/LibraryController';
import { LibraryLookupError } from '../../services/LibraryService';
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

  it('answers 500 "Library unavailable" when the lookup itself failed', async () => {
    libraryService.getLibrary.mockRejectedValue(new LibraryLookupError());
    const res = makeRes();

    await controller.getLibraryContentPath(request(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Library unavailable' });
  });

  it('keeps 400 for every other error', async () => {
    libraryService.getLibrary.mockRejectedValue(new Error('boom'));
    const res = makeRes();

    await controller.getLibraryContentPath(request(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'boom' });
  });

  it('returns the listing on success without touching the status', async () => {
    libraryService.getLibrary.mockResolvedValue([{ relativePath: 'Folder/a.m4b' }]);
    const res = makeRes();

    await controller.getLibraryContentPath(request(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      content: [{ relativePath: 'Folder/a.m4b' }],
      lastItemPlayed: undefined,
    });
  });
});
