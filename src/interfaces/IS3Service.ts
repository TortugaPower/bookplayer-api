import { Readable } from 'stream';
import { S3ClientHeaders, StorageAction, StorageItem } from '../types/user';

export interface IS3Service {
  fileExists(key: string): Promise<boolean>;
  GetDirectoryContent(path: string, isFolder?: boolean): Promise<StorageItem[]>;
  GetPresignedUrl(
    key: string,
    type: StorageAction,
    bucket?: string,
  ): Promise<{
    url: string;
    expires_in: number;
  }>;
  moveFile(sourceKey: string, targetKey: string): Promise<boolean>;
  deleteFile(sourceKey: string): Promise<boolean>;
  calculateFolderSize(folderKey: string): Promise<number>;
  GetObjectStream(
    key: string,
    headers?: S3ClientHeaders,
  ): Promise<{
    statusCode: number;
    body: Readable;
    headers: { [k: string]: string | number };
  }>;
}
