import { LibraryItem, User } from "../types/user";

export interface ILibraryService {
  GetLibrary(user: User, path: string): Promise<LibraryItem[]>;
}
