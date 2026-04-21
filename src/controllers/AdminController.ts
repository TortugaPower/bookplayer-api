import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../types/http';
import type { AdminService } from '../services/AdminService';
import type { StorageService } from '../services/StorageService';
import type { LoggerService } from '../services/LoggerService';

@injectable()
export class AdminController {
  @inject(TYPES.AdminService)
  private _adminService: AdminService;
  @inject(TYPES.StorageService)
  private _storageService: StorageService;
  @inject(TYPES.LoggerService)
  private _loggerService: LoggerService;

  public async SetUserUsage(req: IRequest, res: IResponse): Promise<IResponse> {
    const users = await this._adminService.GetUsersStats();
    await Promise.all(
      users.map(async (user) => {
        try {
          const folderSize = await this._storageService.calculateFolderSize({
            folderKey: `${user.email}/`,
          });
          const thumbailsSize = await this._storageService.calculateFolderSize({
            folderKey: `${user.email}_thumbnail/`,
          });
          // foldersize is bytes
          user.size = parseFloat(
            ((folderSize + thumbailsSize) / 1024 / 1024 / 1024).toFixed(2),
          );
        } catch (error) {
          this._loggerService.log({
            origin: 'SetUserUsage',
            error: error.message,
          });
        }
      }),
    );
    return res.json({ users });
  }

  public async validateSyncBooks(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const usersBooks = await this._adminService.getUserBooks();
    await Promise.all(
      usersBooks.map(async (userBook) => {
        try {
          const source = userBook.source_path || userBook.key;
          const fileExist = await this._storageService.fileExists({
            key: `${userBook.email}/${source}`,
          });
          if (fileExist !== userBook.synced) {
            await this._adminService.updateSync(
              userBook.id_library_item,
              fileExist,
            );
          }
        } catch (error) {
          this._loggerService.log({
            origin: 'SetUserUsage',
            error: error.message,
          });
        }
      }),
    );
    return res.json({ usersBooks: usersBooks.length });
  }
}
