import {
  Bookmark,
  LibraryItemDB,
  LibraryItemMovedDB,
  LibraryItem,
  User,
  ItemMatchPayload,
  MatchUuidsResult,
} from '../types/user';

export interface ILibraryService {
  dbGetLibrary(
    user_id: number,
    path: string,
    filter?: {
      rawFilter?: string;
      exactly?: boolean;
    },
  ): Promise<LibraryItemDB[]>;
  dbGetLibraryByUuid(
    user_id: number,
    uuid: string,
    filter?: {
      rawFilter?: string;
      exactly?: boolean;
    },
  ): Promise<LibraryItemDB[]>;
  getItemByThumbnail(user_id: number, thumbnail: string): Promise<LibraryItemDB>;
  GetLibrary(
    user: User,
    path: string,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
    uuid?: string
  ): Promise<LibraryItem[]>;
  GetObject(
    user: User,
    path: string,
    appVersion?: string,
  ): Promise<LibraryItem>;
  PutObject(user: User, params: LibraryItem): Promise<LibraryItem>;
  DeleteObject(user: User, params: LibraryItem): Promise<string[]>;
  UpdateObject(
    user: User,
    relativePath: string,
    params: LibraryItem,
    uuid?: string
  ): Promise<boolean>;
  reOrderObject(user: User, params: LibraryItem): Promise<boolean>;
  moveLibraryObject(
    user: User,
    params: {
      origin: string;
      destination: string;
      originUuid?: string;
      destinationUuid?: string;
    },
  ): Promise<LibraryItemMovedDB[]>;
  deleteFolderMoving(user: User, folderPath: string): Promise<boolean>;
  dbGetLastItemPlayed(
    user: User,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
  ): Promise<LibraryItem>;
  getBookmarks(params: { key?: string; uuid?: String, user_id: number }): Promise<Bookmark[]>;
  upsertBookmark(bookmark: Bookmark): Promise<Bookmark>;
  thumbailPutRequest(
    user: User,
    params: {
      relativePath: string;
      uuid?: string;
      thumbnail_name: string;
      uploaded?: boolean;
    },
  ): Promise<string | boolean>;
  renameLibraryObject(
    user: User,
    params: {
      item: LibraryItemDB;
      newName: string;
    },
  ): Promise<LibraryItemMovedDB[]>;
  dbGetAllKeys(user_id: number): Promise<string[]>;
  processItemUUIDs(updates: ItemMatchPayload[]): Promise<MatchUuidsResult>;
}
