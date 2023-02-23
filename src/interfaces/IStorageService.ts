import { S3Action, StorageItem } from '../types/user';

export interface IStorageService {
  GetDirectoryContent(path: string, isFolder?: boolean): Promise<StorageItem[]>;
  GetPresignedUrl(
    key: string,
    type: S3Action,
  ): Promise<{
    url: string;
    expires_in: number;
  }>;
  copyFile(
    sourceKey: string,
    targetKey: string,
    move: boolean,
  ): Promise<boolean>;
}
