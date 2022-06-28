import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { ISubscriptionService } from '../interfaces/ISubscriptionService';
import { ILibraryController } from '../interfaces/ILibraryController';
import { ILibraryService } from '../interfaces/ILibraryService';


@injectable()
export class LibraryController implements ILibraryController {
  @inject(TYPES.LibraryService)
  private _libraryService: ILibraryService;

  public async getLibraryContentPath(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const { relativePath, sign } = req.query;
      const user = req.user;
      const path = `${user.email}/${relativePath ? relativePath : ''}`;
      const content = await this._libraryService.GetLibrary(user, path, sign);
      return res.json({ content });
    } catch(err) {
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async getLibraryObject(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const { relativePath } = req.body;
      const user = req.user;
      const pathKey = `${user.email}/${relativePath ? relativePath : ''}`;
      const content = await this._libraryService.GetObject(user, pathKey);
      return res.json({ content });
    } catch(err) {
      res.status(400).json({ message: err.message });
      return;
    }
  }

  public async putLibraryObject(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const params = req.body;
      const user = req.user;
      const content = await this._libraryService.PutObject(user, params);
      return res.json({ content });
    } catch(err) {
      res.status(400).json({ message: err.message });
      return;
    }
  }
}
