import {
  AppleJWT,
  AppleUser,
  SignApple,
  User,
  TypeUserParams,
  UserSession,
  UserEventEnum,
  UserEvent,
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
  insertNewEvent(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
    event_data: object;
  }): Promise<number>;
  getSecondOnboardings(params: { onboarding_name: string }): Promise<{
    [k: string]: object;
  }>;
  getLastUserEvent(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
  }): Promise<UserEvent>;
  getUserEventCount(params: {
    event_name: UserEventEnum;
    user_id?: number;
    external_id?: string;
  }): Promise<number>;

  // Duplicate Prevention Methods
  GetAuthMethodByExternalId(params: {
    auth_type: string;
    external_id: string;
  }): Promise<{
    user_id: number;
    id_auth_method: number;
    email: string;
  } | null>;

  AddAuthMethod(params: {
    user_id: number;
    auth_type: string;
    external_id: string;
    is_primary?: boolean;
    metadata?: object;
  }): Promise<{ id_auth_method: number } | null>;
}
