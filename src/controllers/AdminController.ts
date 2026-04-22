import { IRequest, IResponse } from '../types/http';
import { AdminService } from '../services/AdminService';
import { StorageService } from '../services/StorageService';
import { logger } from '../services/LoggerService';

export class AdminController {
  private readonly _loggerService = logger;

  constructor(
    private _adminService: AdminService = new AdminService(),
    private _storageService: StorageService = new StorageService(),
  ) {}

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
