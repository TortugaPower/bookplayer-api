import { S3Action, StorageItem } from '../types/user';

export interface IStorageService {
  fileExists(key: string): Promise<boolean>;
  GetDirectoryContent(path: string, isFolder?: boolean): Promise<StorageItem[]>;
  GetPresignedUrl(
    key: string,
    type: S3Action,
    bucket?: string,
  ): Promise<{
    url: string;
    expires_in: number;
  }>;
  moveFile(sourceKey: string, targetKey: string): Promise<boolean>;
  deleteFile(sourceKey: string): Promise<boolean>;
}
