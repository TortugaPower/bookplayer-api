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
  session?: string;
  params?: UserParamsObject;
};

export type AppleUser = {
  id_user?: number;
  email: string;
  [TypeUserParams.apple_id]: string;
};

export type UserSession = {
  email?: string;
  session?: string;
  user_id?: number;
};

export type UserDevice = {
  id_user_device?: number;
  user_id: number;
  external_id: string;
  device_os: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type UserParam = {
  id_param?: number;
  user_id: number;
  param: string;
  value: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

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
  apple_id = 'apple_id',
}
export type UserParamsObject = { [key in TypeUserParams]?: unknown };

export type RevenuecatEvent = {
  aliasis: string[];
  app_id: string;
  country_code: string;
  currency: string;
  entitlement_id: string;
  environment: string;
  expiration_at_ms: number;
  id: string;
  original_app_user_id: string;
  period_type: string;
  price: number;
  product_id: string;
  purchased_at_ms: number;
  takehome_percentage: number;
  type: string;
};

export type HTTPMethod =
  | 'get'
  | 'GET'
  | 'delete'
  | 'DELETE'
  | 'head'
  | 'HEAD'
  | 'options'
  | 'OPTIONS'
  | 'post'
  | 'POST'
  | 'put'
  | 'PUT'
  | 'patch'
  | 'PATCH'
  | 'purge'
  | 'PURGE'
  | 'link'
  | 'LINK'
  | 'unlink'
  | 'UNLINK';

export interface RestClientProps {
  headers?: object;
  baseURL: string;
  body?: object | null;
  service: string;
  method: HTTPMethod;
}

export enum LibraryItemOutput {
  DB = '1',
  API = '0',
}
export enum LibraryItemType {
  BOOK = '2',
  FOLDER = '0',
  BOUND = '1',
}
export interface LibraryItem {
  relativePath: string;
  originalFileName: string;
  title: string;
  details: string;
  speed: number;
  currentTime: number;
  duration: number;
  percentCompleted: number;
  isFinished: boolean;
  orderRank: number;
  lastPlayDateTimestamp: number;
  type: LibraryItemType;
  url: string | null | undefined;
  expires_in?: number;
  thumbnail?: string;
}

export interface LibraryItemMovedDB {
  id_library_item: number;
  key: string;
  old_key: string;
  type: LibraryItemType;
}

export interface LibrarItemDB {
  id_library_item?: number;
  user_id?: number;
  key: string;
  original_filename: string;
  title: string;
  speed: number;
  actual_time: string;
  details: string;
  duration: string;
  percent_completed: number;
  order_rank: number;
  last_play_date: number;
  type: LibraryItemType;
  is_finish: boolean;
  thumbnail?: string;
  active?: boolean;
}

export interface StorageItem {
  Key?: string;
  LastModified?: Date;
  ETag?: string;
  Size?: number;
  isFolder?: boolean;
}

export enum S3Action {
  PUT = 'put',
  GET = 'get',
}

export interface SocketDefaultEventsMap {
  [event: string]: (...args: unknown[]) => void;
}

export interface Bookmark {
  title?: string;
  key: string;
  note?: string;
  time: number;
  library_item_id?: number;
  active: boolean;
}
