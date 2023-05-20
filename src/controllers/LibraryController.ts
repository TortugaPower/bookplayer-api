import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { ILibraryController } from '../interfaces/ILibraryController';
import { ILibraryService } from '../interfaces/ILibraryService';
import { Bookmark, LibraryItem } from '../types/user';

@injectable()
export class LibraryController implements ILibraryController {
  @inject(TYPES.LibraryService)
  private _libraryService: ILibraryService;

  public async getLibraryContentPath(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { relativePath, sign } = req.query;
      const user = req.user;
      const path = `${user.email}/${relativePath ? relativePath : ''}`;
      const content = await this._libraryService.GetLibrary(user, path, sign);
      let lastItemPlayed;
      if (!relativePath || relativePath === '/' || relativePath === '') {
        lastItemPlayed = await this._libraryService.dbGetLastItemPlayed(
          user,
          sign,
        );
      }
      return res.json({ content, lastItemPlayed });
    } catch (err) {
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
      const lastItemPlayed = await this._libraryService.dbGetLastItemPlayed(
        user,
        sign,
      );
      return res.json({ lastItemPlayed });
    } catch (err) {
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
      const pathKey = `${user.email}/${relativePath ? relativePath : ''}`;

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
        await this._libraryService.UpdateObject(
          user,
          relativePath,
          updateObj as unknown as LibraryItem,
        );
      }

      const content = await this._libraryService.GetObject(user, pathKey);

      return res.json({ content });
    } catch (err) {
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
        (await this._libraryService.PutObject(user, params)) ?? {};
      return res.json({ content });
    } catch (err) {
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
      const content = await this._libraryService.DeleteObject(user, params);
      return res.json({ content });
    } catch (err) {
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
      const content = await this._libraryService.reOrderObject(user, params);
      return res.json({ content });
    } catch (err) {
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
      const content = await this._libraryService.moveLibraryObject(
        user,
        params,
      );
      return res.json({ content });
    } catch (err) {
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
      const success = await this._libraryService.deleteFolderMoving(
        user,
        relativePath,
      );
      return res.json({ success });
    } catch (err) {
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
      const { relativePath } = req.body;
      const bookmarks = await this._libraryService.getBookmarks({
        user_id: user.id_user,
        key: relativePath,
      });
      return res.json({ bookmarks });
    } catch (err) {
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
      const itemDB = await this._libraryService.dbGetLibrary(
        user.id_user,
        bookmark.key,
        { exactly: true },
      );
      if (!itemDB || !itemDB[0]) {
        throw new Error('Invalid key');
      }
      bookmark.library_item_id = itemDB[0].id_library_item;
      const inserted = await this._libraryService.upsertBookmark(bookmark);
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
      const url = await this._libraryService.thumbailPutRequest(
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
      res.status(400).json({ message: err.message });
      return;
    }
  }
}
