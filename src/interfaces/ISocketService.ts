import http from 'http';

export interface ISocketService {
  setupClient(httpServer: http.Server): void;
}
