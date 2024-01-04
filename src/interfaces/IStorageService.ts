import { Readable } from 'stream';
import {
  S3ClientHeaders,
  StorageAction,
  StorageItem,
  StorageOrigin,
} from '../types/user';

export interface IStorageService {
  fileExists(params: { key: string; origin?: StorageOrigin }): Promise<boolean>;
  GetDirectoryContent(params: {
    path: string;
    isFolder: boolean;
    origin?: StorageOrigin;
  }): Promise<StorageItem[]>;
  GetPresignedUrl(params: {
    key: string;
    type: StorageAction;
    bucket?: string;
    origin?: StorageOrigin;
  }): Promise<{
    url: string;
    expires_in: number;
  }>;
  moveFile(params: {
    sourceKey: string;
    targetKey: string;
    origin?: StorageOrigin;
  }): Promise<boolean>;
  deleteFile(params: {
    sourceKey: string;
    origin?: StorageOrigin;
  }): Promise<boolean>;
  calculateFolderSize(params: {
    folderKey: string;
    origin?: StorageOrigin;
  }): Promise<number>;
  GetObjectStream(params: {
    key: string;
    origin?: StorageOrigin;
    clientHeaders?: S3ClientHeaders;
  }): Promise<{
    statusCode: number;
    body: Readable;
    headers: { [k: string]: string | number };
  }>;
}
