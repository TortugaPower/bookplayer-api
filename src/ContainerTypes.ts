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
  LoggerService: Symbol.for('LoggerService'),
};

export { TYPES };
