import { UserStats } from '../types/user';

export interface IAdminService {
  GetUsersStats(): Promise<UserStats[]>;
}
