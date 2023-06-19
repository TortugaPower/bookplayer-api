import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IUserService } from '../interfaces/IUserService';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { IAdminController } from '../interfaces/IAdminController';
import { IAdminService } from '../interfaces/IAdminService';
import { IStorageService } from '../interfaces/IStorageService';
import { ILoggerService } from '../interfaces/ILoggerService';

@injectable()
export class AdminController implements IAdminController {
  @inject(TYPES.AdminService)
  private _adminService: IAdminService;
  @inject(TYPES.StorageService)
  private _storageService: IStorageService;
  @inject(TYPES.LoggerService)
  private _loggerService: ILoggerService;

  public async SetUserUsage(req: IRequest, res: IResponse): Promise<IResponse> {
    const users = await this._adminService.GetUsersStats();
    await Promise.all(
      users.map(async (user) => {
        try {
          const folderSize = await this._storageService.calculateFolderSize(
            `${user.email}/`,
          );
          // foldersize is bytes
          user.size = parseFloat((folderSize / 1024 / 1024 / 1024).toFixed(2));
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
}
