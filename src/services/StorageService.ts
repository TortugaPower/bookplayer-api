import { inject, injectable } from 'inversify';
import {
  S3ClientHeaders,
  StorageAction,
  StorageItem,
  StorageOrigin,
} from '../types/user';
import { ILoggerService } from '../interfaces/ILoggerService';
import { TYPES } from '../ContainerTypes';
import { IS3Service } from '../interfaces/IS3Service';
import { Readable } from 'stream';
@injectable()
export class StorageService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  @inject(TYPES.S3Service)
  private _s3Service: IS3Service;

  async fileExists(params: {
    key: string;
    origin?: StorageOrigin;
  }): Promise<boolean> {
    try {
      const { key, origin } = params;
      const storageOrigin = origin || StorageOrigin.S3;
      let exist = false;
      switch (storageOrigin) {
        case StorageOrigin.S3:
          exist = await this._s3Service.fileExists(key);
          break;
        default:
          break;
      }
      return exist;
    } catch (error) {
      this._logger.log({
        origin: 'Storage: fileExists',
        message: error.message,
        data: params,
      });
      return null;
    }
  }

  async GetDirectoryContent(params: {
    path: string;
    isFolder: boolean;
    origin?: StorageOrigin;
  }): Promise<StorageItem[]> {
    try {
      const { path, isFolder, origin } = params;
      const storageOrigin = origin || StorageOrigin.S3;
      let content: StorageItem[] = [];
      switch (storageOrigin) {
        case StorageOrigin.S3:
          content = await this._s3Service.GetDirectoryContent(path, isFolder);
          break;
        default:
          break;
      }
      return content;
    } catch (err) {
      this._logger.log({
        origin: 'Storage: GetDirectoryContent',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async GetPresignedUrl(params: {
    key: string;
    type: StorageAction;
    bucket?: string;
    origin?: StorageOrigin;
  }): Promise<{
    url: string;
    expires_in: number;
  }> {
    const { key, type, bucket, origin } = params;
    const storageOrigin = origin || StorageOrigin.S3;
    try {
      let response: {
        url: string;
        expires_in: number;
      };
      switch (storageOrigin) {
        case StorageOrigin.S3:
          response = await this._s3Service.GetPresignedUrl(key, type, bucket);
          break;
        default:
          break;
      }
      return response;
    } catch (error) {
      this._logger.log({
        origin: 'Storage: GetPresignedUrl',
        message: error.message,
        data: params,
      });
      return null;
    }
  }

  async moveFile(params: {
    sourceKey: string;
    targetKey: string;
    origin?: StorageOrigin;
  }): Promise<boolean> {
    try {
      const { sourceKey, targetKey, origin } = params;
      const storageOrigin = origin || StorageOrigin.S3;
      let moved = false;
      switch (storageOrigin) {
        case StorageOrigin.S3:
          moved = await this._s3Service.moveFile(sourceKey, targetKey);
          break;
        default:
          break;
      }
      return moved;
    } catch (error) {
      this._logger.log({
        origin: 'Storage: moveFile',
        message: error.message,
        data: params,
      });
      return null;
    }
  }

  async deleteFile(params: {
    sourceKey: string;
    origin?: StorageOrigin;
  }): Promise<boolean> {
    try {
      /// Keep a copy for a week just in case for support purposes
      const { sourceKey, origin } = params;
      const storageOrigin = origin || StorageOrigin.S3;
      let deleted = false;
      switch (storageOrigin) {
        case StorageOrigin.S3:
          deleted = await this._s3Service.deleteFile(sourceKey);
          break;
        default:
          break;
      }
      return deleted;
    } catch (error) {
      this._logger.log({
        origin: 'Storage: deleteFile',
        message: error.message,
        data: params,
      });
      return null;
    }
  }
  async calculateFolderSize(params: {
    folderKey: string;
    origin?: StorageOrigin;
  }): Promise<number> {
    try {
      const { folderKey, origin } = params;
      const storageOrigin = origin || StorageOrigin.S3;
      let totalSize = 0;
      switch (storageOrigin) {
        case StorageOrigin.S3:
          totalSize = await this._s3Service.calculateFolderSize(folderKey);
          break;
        default:
          break;
      }
      return totalSize;
    } catch (error) {
      console.error(error);
      this._logger.log({
        origin: 'Storage: calculateFolderSize',
        message: error.message,
        data: params,
      });
      return null;
    }
  }

  async GetObjectStream(params: {
    key: string;
    origin?: StorageOrigin;
    clientHeaders?: S3ClientHeaders;
  }): Promise<{
    statusCode: number;
    body: Readable;
    headers: { [k: string]: string | number };
  }> {
    const { key, origin, clientHeaders } = params;
    const storageOrigin = origin || StorageOrigin.S3;
    try {
      let response = null;
      switch (storageOrigin) {
        case StorageOrigin.S3:
          response = await this._s3Service.GetObjectStream(key, clientHeaders);
          break;
        default:
          break;
      }
      return response;
    } catch (error) {
      this._logger.log({
        origin: 'Storage: GetObjectStream',
        message: error.message,
        data: params,
      });
      return null;
    }
  }
}
