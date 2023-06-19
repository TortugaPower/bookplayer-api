import { inject, injectable } from 'inversify';
import { UserStats } from '../types/user';
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
}
