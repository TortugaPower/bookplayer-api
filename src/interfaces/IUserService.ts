import {
  AppleJWT,
  AppleUser,
  SignApple,
  User,
  TypeUserParams,
  UserSession,
} from '../types/user';

export interface IUserService {
  TokenUser(UserLogged: User): Promise<string>;
  GetUser({ email, session }: UserSession): Promise<User>;
  getUserParam(params: {
    user_id: number;
    param: TypeUserParams;
  }): Promise<string>;
  verifyToken({ token_id, client_id }: SignApple): Promise<AppleJWT>;
  AddNewUser(newUser: User): Promise<User>;
  AddNewDevice(userSession: UserSession): Promise<number>;
  GetUserByAppleID(apple_id: string[]): Promise<AppleUser>;
  UpdateSubscription(user_id: number, subscription: string): Promise<boolean>;
  DeleteAccount(user_id: number): Promise<boolean>;
  getUserSubscriptionState(user_id: number): Promise<string>;
  getClientID(p: { origin: string }): Promise<{
    apple_id: string;
    app_version: string;
  }>;
  checkIfAdmin(user_id: number): Promise<boolean>;
}
