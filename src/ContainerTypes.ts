const TYPES = {
  Server: Symbol.for('Server'),
  RouterHttp: Symbol.for('RouterHttp'),
  UserRouter: Symbol.for('UserRouter'),
  UserController: Symbol.for('UserController'),
  UserServices: Symbol.for('UserService'),
  SubscriptionController: Symbol.for('SubscriptionController'),
  SubscriptionService: Symbol.for('SubscriptionService'),
  RestClientService: Symbol.for('RestClientService'),
  StorageService: Symbol.for('StorageService'),
  LibraryService: Symbol.for('LibraryService'),
  LibraryController: Symbol.for('LibraryController'),
  LibraryRouter: Symbol.for('LibraryRouter'),
  SocketService: Symbol.for('SocketService'),
  CacheService: Symbol.for('CacheService'),
  SubscriptionMiddleware: Symbol.for('SubscriptionMiddleware'),
  UserAdminMiddleware: Symbol.for('UserAdminMiddleware'),
  LoggerService: Symbol.for('LoggerService'),
  AdminService: Symbol.for('AdminService'),
  AdminController: Symbol.for('AdminController'),
  AdminRouter: Symbol.for('AdminRouter'),
};

export { TYPES };
