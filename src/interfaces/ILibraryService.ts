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
  getItemByThumbnail(user_id: number, thumbnail: string): Promise<LibrarItemDB>;
  GetLibrary(
    user: User,
    path: string,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
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
  ): Promise<boolean>;
  reOrderObject(user: User, params: LibraryItem): Promise<boolean>;
  moveLibraryObject(
    user: User,
    params: {
      origin: string;
      destination: string;
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
  getBookmarks(params: { key?: string; user_id: number }): Promise<Bookmark[]>;
  upsertBookmark(bookmark: Bookmark): Promise<Bookmark>;
  thumbailPutRequest(
    user: User,
    params: {
      relativePath: string;
      thumbnail_name: string;
      uploaded?: boolean;
    },
  ): Promise<string | boolean>;
  renameLibraryObject(
    user: User,
    params: {
      item: LibrarItemDB;
      newName: string;
    },
  ): Promise<LibraryItemMovedDB[]>;
  dbGetAllKeys(user_id: number): Promise<string[]>;
}

export interface ILibraryServiceDeprecated {
  dbGetLibrary(
    user_id: number,
    path: string,
    filter?: {
      rawFilter?: string;
      exactly?: boolean;
    },
  ): Promise<LibrarItemDB[]>;
  getItemByThumbnail(user_id: number, thumbnail: string): Promise<LibrarItemDB>;
  GetLibrary(
    user: User,
    path: string,
    options: {
      withPresign?: boolean; // deprecated
      appVersion: string;
    },
  ): Promise<LibraryItem[]>;
  GetObject(user: User, path: string): Promise<LibraryItem>;
  PutObject(user: User, params: LibraryItem): Promise<LibraryItem>;
  DeleteObject(user: User, params: LibraryItem): Promise<string[]>;
  UpdateObject(
    user: User,
    relativePath: string,
    params: LibraryItem,
  ): Promise<boolean>;
  reOrderObject(user: User, params: LibraryItem): Promise<boolean>;
  moveLibraryObject(
    user: User,
    params: {
      origin: string;
      destination: string;
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
  getBookmarks(params: { key?: string; user_id: number }): Promise<Bookmark[]>;
  upsertBookmark(bookmark: Bookmark): Promise<Bookmark>;
  thumbailPutRequest(
    user: User,
    params: {
      relativePath: string;
      thumbnail_name: string;
      uploaded?: boolean;
    },
  ): Promise<string | boolean>;
  renameLibraryObject(
    user: User,
    params: {
      item: LibrarItemDB;
      newName: string;
    },
  ): Promise<LibraryItemMovedDB[]>;
  dbGetAllKeys(user_id: number): Promise<string[]>;
}
