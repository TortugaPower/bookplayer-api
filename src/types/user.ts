
export interface SignApple {
  token_id: string;
}

export type User = {
  id_user?: number;
  email: string;
  password?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  [TypeUserParams.subscription]?: string;
  session?: string;
}

export type UserSession = {
  email?: string;
  session?: string;
  user_id?: number;
}

export type UserDevice = {
  id_user_device?: number;
  user_id: number;
  external_id: string;
  device_os: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type UserParam = {
  id_param?: number;
  user_id: number;
  param: string;
  value: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type AppleJWT = {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email: string;
  auth_time: number;
};

export enum TypeUserParams {
  subscription = 'subscription',
}
export type UserParamsObject = { [key in TypeUserParams]: unknown };