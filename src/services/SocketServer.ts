/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from 'socket.io';
import { injectable } from 'inversify';
import http from 'http';
import { SocketDefaultEventsMap } from '../types/user';

enum SocketStates {
  CONNECTION = 'connection',
}

@injectable()
export class SocketService {
  private socketServer: Server<
    SocketDefaultEventsMap,
    SocketDefaultEventsMap,
    SocketDefaultEventsMap,
    any
  >;

  async setupClient(httpServer: http.Server) {
    if (!this.socketServer) {
      this.socketServer = new Server(httpServer);
      console.log('123', SocketStates.CONNECTION);
      this.socketServer.on(SocketStates.CONNECTION, (socket) => {
        console.log('new connection');
      });
    }
  }
}
