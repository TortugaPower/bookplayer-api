import { UserBooks, UserStats } from '../types/user';

export interface IAdminService {
  GetUsersStats(): Promise<UserStats[]>;
  getUserBooks(): Promise<UserBooks[]>;
  updateSync(id_library_item: number, synced: boolean): Promise<UserBooks[]>;
}
