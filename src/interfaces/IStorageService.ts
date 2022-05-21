import { StorageItem } from "../types/user";

export interface IStorageService {
  GetDirectoryContent(path: string): Promise<StorageItem[]>;
}
