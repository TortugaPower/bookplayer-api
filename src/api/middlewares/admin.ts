import { inject, injectable } from 'inversify';
import { IRequest, IResponse, INext } from '../../types/http';
import { TYPES } from '../../ContainerTypes';
import type { UserServices } from '../../services/UserServices';

@injectable()
export class UserAdminMiddleware {
  @inject(TYPES.UserServices) private _userService: UserServices;
  async checkUserAdmin(
    req: IResponse,
    res: IRequest,
    next: INext,
  ): Promise<void> {
    try {
      const user = req.user;
      if (user) {
        const isAdmin = await this._userService.checkIfAdmin(user.id_user);
        if (!isAdmin) {
          return res.status(403).json({ message: 'You are not allowed here' });
        }
        next();
      } else {
        return res.status(400).json({ message: 'the user is invalid' });
      }
    } catch (error) {
      next(error);
    }
  }
}
