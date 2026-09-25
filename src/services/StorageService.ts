import {
  S3ClientHeaders,
  StorageAction,
  StorageItem,
  StorageOrigin,
} from '../types/user';
import { logger } from './LoggerService';
import { S3Service, ObjectHead } from './S3Service';
import { Readable } from 'stream';
import { stripStoragePrefix } from '../utils';
import {
  INVALID_PART_LIST,
  MultipartPart,
  MultipartUploadRef,
  NO_SUCH_UPLOAD,
} from '../types/multipartUpload';

export class StorageService {
  private readonly _logger = logger;

  constructor(private _s3Service: S3Service = new S3Service()) {}

  /** Tri-state; see S3Service.fileExists. null means "could not determine". */
  async fileExists(params: {
    key: string;
    origin?: StorageOrigin;
  }): Promise<boolean | null> {
    try {
      const { key, origin } = params;
      const storageOrigin = origin || StorageOrigin.S3;
      let exist: boolean | null = false;
      switch (storageOrigin) {
        case StorageOrigin.S3:
          exist = await this._s3Service.fileExists(key);
          break;
        default:
          break;
      }
      return exist;
    } catch (error) {
      // Prefix-stripped and at 'warn' for the same reasons as the moveFile
      // catches: params.key carries the per-user prefix, which is the account
      // email for legacy accounts, and this null drives the caller's pin.
      this._logger.log(
        {
          origin: 'StorageService.fileExists',
          message: error.message,
          data: { key: stripStoragePrefix(params.key) },
        },
        'warn',
      );
      return null;
    }
  }

  async headObject(params: {
    key: string;
    origin?: StorageOrigin;
  }): Promise<ObjectHead | 'missing' | null> {
    try {
      const { key, origin } = params;
      switch (origin || StorageOrigin.S3) {
        case StorageOrigin.S3:
          return await this._s3Service.headObject(key);
        default:
          return null;
      }
    } catch (error) {
      this._logger.log(
        { origin: 'StorageService.headObject', message: error.message, data: { key: stripStoragePrefix(params.key) } },
        'warn',
      );
      return null;
    }
  }

  async restoreObject(params: {
    key: string;
    days: number;
    tier: 'Standard' | 'Bulk';
    origin?: StorageOrigin;
  }): Promise<boolean | null> {
    try {
      const { key, days, tier, origin } = params;
      switch (origin || StorageOrigin.S3) {
        case StorageOrigin.S3:
          return await this._s3Service.restoreObject(key, { days, tier });
        default:
          return null;
      }
    } catch (error) {
      this._logger.log(
        { origin: 'StorageService.restoreObject', message: error.message, data: { key: stripStoragePrefix(params.key) } },
        'warn',
      );
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
      // See S3Service.moveFile: logged at 'error' so the desync is visible in
      // production, where LOG_LEVEL is 'warn'. `params` is not logged whole —
      // its keys carry the per-user storage prefix, which is the account's
      // email for the legacy accounts this path serves.
      this._logger.log(
        {
          origin: 'StorageService.moveFile',
          message: error.message,
          data: {
            sourceKey: stripStoragePrefix(params.sourceKey),
            targetKey: stripStoragePrefix(params.targetKey),
          },
        },
        'error',
      );
      return false;
    }
  }

  async deleteFile(params: {
    sourceKey: string;
    origin?: StorageOrigin;
  }): Promise<boolean> {
    try {
      /// Keep a copy for support purposes; S3Service.deleteFile writes it to
      /// the `deleted_` prefix, which `remove-deleted-items` expires after 3
      /// days.
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

  // Multipart uploads exist only on S3, so these delegate without an origin
  // switch. S3Service logs and returns null on unexpected failures.
  createMultipartUpload(key: string): Promise<string | null> {
    return this._s3Service.createMultipartUpload(key);
  }

  getPresignedPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<{ url: string; expires_in: number } | null> {
    return this._s3Service.getPresignedPartUrl(key, uploadId, partNumber);
  }

  listParts(
    key: string,
    uploadId: string,
  ): Promise<MultipartPart[] | typeof NO_SUCH_UPLOAD | null> {
    return this._s3Service.listParts(key, uploadId);
  }

  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<true | typeof NO_SUCH_UPLOAD | typeof INVALID_PART_LIST | null> {
    return this._s3Service.completeMultipartUpload(key, uploadId, parts);
  }

  abortMultipartUpload(key: string, uploadId: string): Promise<boolean | null> {
    return this._s3Service.abortMultipartUpload(key, uploadId);
  }

  listMultipartUploads(prefix: string): Promise<MultipartUploadRef[] | null> {
    return this._s3Service.listMultipartUploads(prefix);
  }
}
