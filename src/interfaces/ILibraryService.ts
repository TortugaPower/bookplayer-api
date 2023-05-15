import {
  Bookmark,
  LibrarItemDB,
  LibraryItemMovedDB,
  LibraryItem,
  User,
} from '../types/user';

export interface ILibraryService {
  dbGetLibrary(
    user_id: number,
    path: string,
    filter?: {
      rawFilter?: string;
      exactly?: boolean;
    },
  ): Promise<LibrarItemDB[]>;
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
  ): Promise<LibraryItemMovedDB[]>;
  deleteFolderMoving(user: User, folderPath: string): Promise<boolean>;
  dbGetLastItemPlayed(user: User, withPresign?: boolean): Promise<LibraryItem>;
  getBookmarks(params: { key?: string; user_id: number }): Promise<Bookmark[]>;
  upsertBookmark(bookmark: Bookmark): Promise<Bookmark>;
}
