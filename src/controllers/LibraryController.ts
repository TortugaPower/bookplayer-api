import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { ILibraryController } from '../interfaces/ILibraryController';
import {
  ILibraryService,
  ILibraryServiceDeprecated,
} from '../interfaces/ILibraryService';
import { ILoggerService } from '../interfaces/ILoggerService';
import { Bookmark, LibraryItem, LibraryItemType } from '../types/user';

@injectable()
export class LibraryController implements ILibraryController {
  @inject(TYPES.LibraryService)
  private _libraryService: ILibraryService;
  @inject(TYPES.LibraryServiceDeprecated)
  private _libraryServiceDeprecated: ILibraryServiceDeprecated;
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  public async getUserLibraryKeys(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const content = req.beta_user
        ? await this._libraryService.dbGetAllKeys(user.id_user)
        : await this._libraryServiceDeprecated.dbGetAllKeys(user.id_user);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'getUserLibraryKeys', message: err.message, data: { user: req.user } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getLibraryContentPath(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, sign, noLastItemPlayed, forceLastItem } = req.query;
      const user = req.user;
      const path = `${user.email}/${relativePath ? relativePath : ''}`;

      const options = {
        withPresign: sign,
        appVersion: req.app_version,
      };
      const content = req.beta_user
        ? await this._libraryService.GetLibrary(user, path, options)
        : await this._libraryServiceDeprecated.GetLibrary(user, path, options);
      let lastItemPlayed;
      if (
        ((!relativePath || relativePath === '/' || relativePath === '') &&
          !noLastItemPlayed) ||
        forceLastItem
      ) {
        lastItemPlayed = req.beta_user
          ? await this._libraryService.dbGetLastItemPlayed(user, options)
          : await this._libraryServiceDeprecated.dbGetLastItemPlayed(
              user,
              options,
            );
      }
      return res.json({ content, lastItemPlayed });
    } catch (err) {
      this._logger.log({ origin: 'getLibraryContentPath', message: err.message, data: { user: req.user, query: req.query } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getLastPlayedItem(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { sign } = req.query;
      const user = req.user;
      const lastItemPlayed = req.beta_user
        ? await this._libraryService.dbGetLastItemPlayed(user, {
            withPresign: sign,
            appVersion: req.app_version,
          })
        : await this._libraryServiceDeprecated.dbGetLastItemPlayed(user, {
            withPresign: sign,
            appVersion: req.app_version,
          });
      return res.json({ lastItemPlayed });
    } catch (err) {
      this._logger.log({ origin: 'getLastPlayedItem', message: err.message, data: { user: req.user, query: req.query } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath } = req.body;
      const user = req.user;

      const updateFields = Object.keys(req.body).filter(
        (key) => key !== 'relativePath' && key !== 'originalFileName',
      );

      if (updateFields.length) {
        const updateObj = updateFields.reduce(
          (obj: { [key: string]: unknown }, key) => {
            obj[key] = req.body[key];
            return obj;
          },
          {},
        );
        if (req.beta_user) {
          await this._libraryService.UpdateObject(
            user,
            relativePath,
            updateObj as unknown as LibraryItem,
          );
        } else {
          await this._libraryServiceDeprecated.UpdateObject(
            user,
            relativePath,
            updateObj as unknown as LibraryItem,
          );
        }
      }

      return res.json({ content: { url: null } });
    } catch (err) {
      this._logger.log({ origin: 'getLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async putLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      /// If there's nothing to upload, content returned will be null
      const content =
        (req.beta_user
          ? await this._libraryService.PutObject(user, params)
          : await this._libraryServiceDeprecated.PutObject(user, params)) ?? {};
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'putLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async deleteLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const content = req.beta_user
        ? await this._libraryService.DeleteObject(user, params)
        : await this._libraryServiceDeprecated.DeleteObject(user, params);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'deleteLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async reorderLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const content = req.beta_user
        ? await this._libraryService.reOrderObject(user, params)
        : await this._libraryServiceDeprecated.reOrderObject(user, params);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'reorderLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async moveLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const content = req.beta_user
        ? await this._libraryService.moveLibraryObject(user, params)
        : await this._libraryServiceDeprecated.moveLibraryObject(user, params);
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'moveLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async deleteFolderMoving(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath } = req.body;

      if (!relativePath) {
        throw new Error('Invalid folder');
      }
      const user = req.user;
      const success = req.beta_user
        ? await this._libraryService.deleteFolderMoving(user, relativePath)
        : await this._libraryServiceDeprecated.deleteFolderMoving(
            user,
            relativePath,
          );
      return res.json({ success });
    } catch (err) {
      this._logger.log({ origin: 'deleteFolderMoving', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getAllUserBookmarks(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const { relativePath } = req.method === 'POST' ? req.body : req.query;
      const bookmarks = req.beta_user
        ? await this._libraryService.getBookmarks({
            user_id: user.id_user,
            key: relativePath,
          })
        : await this._libraryServiceDeprecated.getBookmarks({
            user_id: user.id_user,
            key: relativePath,
          });
      const response: { bookmarks: Bookmark[]; warning?: string } = {
        bookmarks,
      };
      if (req.method === 'POST') {
        response.warning =
          'DEPRECATED: Using POST for /library/bookmarks is deprecated and ' +
          'will be removed in the future. Please use GET.';
        console.error(response.warning, user.id_user);
      }
      return res.json(response);
    } catch (err) {
      this._logger.log({ origin: 'getAllUserBookmarks', message: err.message, data: { user: req.user, body: req.body, query: req.query } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async upsertBookmark(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const bookmark = req.body as Bookmark;
      const itemDB = req.beta_user
        ? await this._libraryService.dbGetLibrary(user.id_user, bookmark.key, {
            exactly: true,
          })
        : await this._libraryServiceDeprecated.dbGetLibrary(
            user.id_user,
            bookmark.key,
            { exactly: true },
          );
      if (!itemDB || !itemDB[0]) {
        throw new Error('Invalid key');
      }
      bookmark.library_item_id = itemDB[0].id_library_item;
      const inserted = req.beta_user
        ? await this._libraryService.upsertBookmark(bookmark)
        : await this._libraryServiceDeprecated.upsertBookmark(bookmark);
      if (!inserted) {
        throw new Error('problem creating the bookmark');
      }
      return res.json({
        bookmark: {
          ...inserted,
          title: itemDB[0].title,
          relativePath: itemDB[0].key,
        },
      });
    } catch (err) {
      this._logger.log({ origin: 'upsertBookmark', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async itemThumbnailPutRequest(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      const thumbnailData = req.body as {
        thumbnail_name: string;
        relativePath: string;
        uploaded?: boolean;
      };
      if (!thumbnailData.thumbnail_name || !thumbnailData.relativePath) {
        throw new Error('Invalid parameters');
      }
      const url = req.beta_user
        ? await this._libraryService.thumbailPutRequest(user, thumbnailData)
        : await this._libraryServiceDeprecated.thumbailPutRequest(
            user,
            thumbnailData,
          );
      if (!url) {
        throw new Error('problem creating the request url');
      }
      return res.json({
        thumbnail_name: thumbnailData.thumbnail_name,
        thumbnail_url: !thumbnailData.uploaded ? url : '',
        uploaded: thumbnailData.uploaded && url,
      });
    } catch (err) {
      this._logger.log({ origin: 'itemThumbnailPutRequest', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async renameLibraryObject(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, newName } = req.body;
      if (!relativePath || !newName) {
        throw new Error('Invalid parameters');
      }
      const user = req.user;
      const cleanPath = relativePath.replace(`${user.email}/`, '');
      const objectDB = req.beta_user
        ? await this._libraryService.dbGetLibrary(user.id_user, cleanPath, {
            exactly: true,
          })
        : await this._libraryServiceDeprecated.dbGetLibrary(
            user.id_user,
            cleanPath,
            {
              exactly: true,
            },
          );
      const itemDb = objectDB[0];
      if (!itemDb) {
        throw Error('Item not found');
      }

      const content = req.beta_user
        ? await this._libraryService.renameLibraryObject(user, {
            item: itemDb,
            newName,
          })
        : await this._libraryServiceDeprecated.renameLibraryObject(user, {
            item: itemDb,
            newName,
          });
      return res.json({ content });
    } catch (err) {
      this._logger.log({ origin: 'renameLibraryObject', message: err.message, data: { user: req.user, body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }
}
