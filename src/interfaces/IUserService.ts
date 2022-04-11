import { AppleJWT, SignApple, User, UserSession } from "../types/user";

export interface IUserService {
  TokenUser(UserLogged: User): Promise<string>;
  GetUser({ email, session }: UserSession): Promise<User>;
  verifyToken({ token_id }: SignApple): Promise<AppleJWT>;
  AddNewUser(newUser: User): Promise<User>;
  AddNewDevice(userSession: UserSession): Promise<number>;
}
