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
}
