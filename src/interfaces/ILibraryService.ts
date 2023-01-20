import { LibraryItem, User } from '../types/user';

export interface ILibraryService {
  GetLibrary(
    user: User,
    path: string,
    withPresign?: boolean,
  ): Promise<LibraryItem[]>;
  GetObject(user: User, path: string): Promise<LibraryItem>;
  PutObject(user: User, params: LibraryItem): Promise<LibraryItem>;
  DeleteObject(user: User, params: LibraryItem): Promise<string[]>;
  UpdateObject(
    user: User,
    relativePath: string,
    params: LibraryItem,
  ): Promise<LibraryItem>;
  reOrderObject(user: User, params: LibraryItem): Promise<LibraryItem>;
  moveLibraryObject(
    user: User,
    params: {
      origin: string;
      destination: string;
    },
  ): Promise<LibraryItem>;
  deleteFolderMoving(user: User, folderPath: string): Promise<boolean>;
  dbGetLastItemPlayed(user: User, withPresign?: boolean): Promise<LibraryItem>;
}
