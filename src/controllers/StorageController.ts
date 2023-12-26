import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { IStorageService } from '../interfaces/IStorageService';
import { IStorageController } from '../interfaces/IStorageController';
import { ILibraryService } from '../interfaces/ILibraryService';
import { Writable } from 'stream';
import { S3ClientHeaders, S3ValidHeader } from '../types/user';
import { ILoggerService } from '../interfaces/ILoggerService';

@injectable()
export class StorageController implements IStorageController {
  @inject(TYPES.StorageService)
  private _storageService: IStorageService;
  @inject(TYPES.LibraryService)
  private _libraryService: ILibraryService;
  @inject(TYPES.LoggerService)
  private _loggerService: ILoggerService;

  public async getProxyLibrary(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const user = req.user;
    const key = req.params[0];
    const pathArray = key?.split('/') || [];
    const rootFolder = pathArray[0];
    let filepath: string;
    switch (rootFolder) {
      case '_thumbnail':
        const itemThumbnail = await this._libraryService.getItemByThumbnail(
          user.id_user,
          pathArray.slice(1)?.join('/'),
        );
        filepath = !!itemThumbnail
          ? `${rootFolder}/${itemThumbnail.thumbnail}`
          : null;
        break;
      default:
        const userItemDB = await this._libraryService.dbGetLibrary(
          user.id_user,
          key,
          {
            exactly: true,
          },
        );
        filepath = userItemDB?.length
          ? `/${userItemDB[0].source_path || userItemDB[0].key}`
          : null;
        break;
    }
    if (!filepath) {
      return res.status(400).json({
        message: 'Invalid request',
      });
    }
    try {
      const clientHeaders: S3ClientHeaders = {};
      const reqHeaders = Object.keys(req.headers).reduce(
        (headers: { [k: string]: string | Date }, headerKey: string) => {
          headers[headerKey.toLowerCase()] = req.headers[headerKey];
          return headers;
        },
        {},
      );
      for (const [key, value] of Object.entries(S3ValidHeader)) {
        const validValue = reqHeaders[key];
        if (validValue) {
          clientHeaders[value] = validValue;
        }
      }
      const userKey = `${user.email}${filepath}`;
      const s3Stream = await this._storageService.GetObjectStream({
        key: userKey,
        clientHeaders,
      });
      if (s3Stream?.body) {
        Object.keys(s3Stream.headers)?.forEach((headerKey: string) => {
          res.setHeader(headerKey, s3Stream.headers[headerKey]);
        });
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.statusCode = s3Stream.statusCode || 200;
        s3Stream?.body.pipe(res as Writable);
      } else {
        return res.status(s3Stream.statusCode).end();
      }
    } catch (error) {
      this._loggerService.log({
        origin: 'getProxyLibrary',
        error: {
          user,
          message: error.message,
        },
      });
      return res.status(500).json({ error: 'Error fetching the file' });
    }
  }
}
