import {
  S3ClientHeaders,
  StorageAction,
  StorageItem,
  StorageOrigin,
} from '../types/user';
import { logger } from './LoggerService';
import { S3Service } from './S3Service';
import { Readable } from 'stream';

export class StorageService {
  private readonly _logger = logger;

  constructor(private _s3Service: S3Service = new S3Service()) {}

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

  async getDirectoryContent(params: {
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
          content = await this._s3Service.getDirectoryContent(path, isFolder);
          break;
        default:
          break;
      }
      return content;
    } catch (err) {
      this._logger.log({
        origin: 'StorageService.getDirectoryContent',
        message: err.message,
        data: params,
      });
      return null;
    }
  }

  async getPresignedUrl(params: {
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
          response = await this._s3Service.getPresignedUrl(key, type, bucket);
          break;
        default:
          break;
      }
      return response;
    } catch (error) {
      this._logger.log({
        origin: 'StorageService.getPresignedUrl',
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

  async getObjectStream(params: {
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
          response = await this._s3Service.getObjectStream(key, clientHeaders);
          break;
        default:
          break;
      }
      return response;
    } catch (error) {
      this._logger.log({
        origin: 'StorageService.getObjectStream',
        message: error.message,
        data: params,
      });
      return null;
    }
  }
}
