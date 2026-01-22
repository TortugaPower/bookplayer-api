import { Router } from 'express';

export interface IUserRouter {
  get(): Router;
}

export interface IRouterHttp {
  get(): Router;
}

export interface ILibraryRouter {
  get(): Router;
}

export interface IAdminRouter {
  get(): Router;
}

export interface IStorageRouter {
  get(): Router;
}

export interface IRetentionMessagingRouter {
  get(): Router;
}
