import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IUserService } from '../interfaces/IUserService';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { IUserController } from '../interfaces/IUserController';


@injectable()
export class UserController implements IUserController {
  @inject(TYPES.UserServices)
  private _userService: IUserService;

  public async getAuth(req: IRequest, res: IResponse): Promise<IResponse> {
    const user = req.user;
    res.json({ user });
    return;
  }

  public async InitLogin(req: IRequest, res: IResponse): Promise<IResponse> {
    const { token_id } = req.body;
    if (!token_id) {
      res.status(422).json({ message: 'The authentication is missing' });
      return;
    }
    const appleAuth = await this._userService.verifyToken({ token_id });
    
    if (!appleAuth?.email || !appleAuth?.sub) {
      res.status(422).json({ message: 'Invalid apple id' });
      return;
    }

    let user = await this._userService.GetUser({
      email: appleAuth.email,
      session: appleAuth.sub,
    });
    if (!user) {
      user = await this._userService.AddNewUser({
        email: appleAuth.email,
        active: true,
        params: { apple_id: appleAuth.sub },
      });
    }
    if (!user.params?.apple_id) {
      res.status(409).json({ message: 'The user exist with different apple id' });
      return;
    }
    if(!user.session) {
      await this._userService.AddNewDevice({ user_id: user.id_user, session: appleAuth.sub });
    }
    const token = await this._userService.TokenUser({
      id_user: user.id_user,
      email: appleAuth.email,
      session: appleAuth.sub,
    });

    return res.json({ email: user.email, token });
  }

  public async DeleteAccount(req: IRequest, res: IResponse): Promise<IResponse> {
    const user = req.user;
    if (!user) {
      res.status(403).json({ message: 'The user is invalid' });
      return;
    }
    const deleted = await this._userService.DeleteAccount(user.id_user);
    if (!deleted) {
      res.status(400).json({ message: 'There is a problem deleting the account' });
      return;
    }
    return res.json({ message: 'The account has been successfully deleted'});
  }
}
