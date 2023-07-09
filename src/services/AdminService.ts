import { inject, injectable } from 'inversify';
import { LibraryItemType, UserBooks, UserStats } from '../types/user';
import database from '../database';
import { ILoggerService } from '../interfaces/ILoggerService';
import { TYPES } from '../ContainerTypes';
@injectable()
export class AdminService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  private db = database;

  async GetUsersStats(): Promise<UserStats[]> {
    try {
      const users = await this.db
        .raw(
          `
        select * from (
          select user_id, email, case when u.active then 'Active' else 'Deleted' end as status,
               sum(case when type = 2 then 1 else 0 end) as books,
               sum(case when type = 0 then 1 else 0 end) as folders,
               sum(case when type = 1 then 1 else 0 end) as bounds
        from library_items
        join users u on library_items.user_id = u.id_user
        group by user_id, email,u.active
        order by books desc
        ) as counts
        where books > 0 or folders > 0 or bounds > 0
      `,
        )
        .then((res) => res.rows);
      return users;
    } catch (err) {
      this._logger.log({
        origin: 'GetUsersStats',
        message: err.message,
      });
      return null;
    }
  }

  async getUserBooks(): Promise<UserBooks[]> {
    try {
      const userBooks = await this.db
        .raw(
          `
          select u.email, li.id_library_item, li.user_id, li.key from library_items li
          join users u on li.user_id = u.id_user
          where li.active=true and li.type=?
        `,
          [LibraryItemType.BOOK],
        )
        .then((res) => res.rows);
      return userBooks;
    } catch (err) {
      this._logger.log({
        origin: 'getUserBooks',
        message: err.message,
      });
      return null;
    }
  }
  async updateSync(
    id_library_item: number,
    synced: boolean,
  ): Promise<UserBooks[]> {
    try {
      const userBooks = await this.db('library_items')
        .update({
          synced,
        })
        .where({
          id_library_item,
        })
        .returning('id_library_item');
      return userBooks[0].id_library_item;
    } catch (err) {
      this._logger.log({
        origin: 'updateSync',
        message: err.message,
      });
      return null;
    }
  }
}
