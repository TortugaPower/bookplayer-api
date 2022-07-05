import { S3Action, StorageItem } from '../types/user';

export interface IStorageService {
  GetDirectoryContent(path: string): Promise<StorageItem[]>;
  GetPresignedUrl(key: string, type: S3Action): Promise<string>;
  copyFile(
    sourceKey: string,
    targetKey: string,
    move: boolean,
  ): Promise<boolean>;
}
