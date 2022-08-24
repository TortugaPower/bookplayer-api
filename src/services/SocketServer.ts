/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from 'socket.io';
import { inject, injectable } from 'inversify';
import http from 'http';
import { SocketDefaultEventsMap } from '../types/user';
import { TYPES } from '../ContainerTypes';
import { ICacheService } from '../interfaces/ICacheService';
import { Handshake } from 'socket.io/dist/socket';
import loggedUser from '../api/middlewares/auth';

enum SocketStates {
  CONNECTION = 'connection',
  DISCONNECT = 'disconnect',
}

@injectable()
export class SocketService {
  @inject(TYPES.CacheService) private _cacheService: ICacheService;
  private socketServer: Server<
    SocketDefaultEventsMap,
    SocketDefaultEventsMap,
    SocketDefaultEventsMap,
    any
  >;

  authValidation(handshake: Handshake): { id_user: number } {
    try {
      const { authorization } = handshake.auth;
      const req: any = {
        headers: {
          authorization,
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      loggedUser(req, {}, () => {});
      if (!req.user) {
        throw new Error('Invalid user');
      }
      return {
        id_user: req.user.id_user,
      };
    } catch (err) {
      return null;
    }
  }

  async setupClient(httpServer: http.Server) {
    if (!this.socketServer) {
      this.socketServer = new Server(httpServer);

      this.socketServer.use((socket, next) => {
        const user = this.authValidation(socket.handshake);
        if (user) {
          socket.data = {
            ...socket.data,
            id_user: user.id_user,
          };
          next();
        } else {
          console.log('invalid');
          next(new Error('invalid'));
        }
      });

      this.socketServer.on(SocketStates.CONNECTION, (socket) => {
        console.log('new connection', socket.id);
        new Promise(async (resolve) => {
          const previousSocket = await this._cacheService.getObject(
            `socket_${socket.data.id_user}`,
          );
          await this._cacheService.setObject(
            `socket_${socket.data.id_user}`,
            !!previousSocket
              ? (previousSocket as string[]).concat([socket.id])
              : [socket.id],
          );
          resolve(null);
        });

        socket.on(SocketStates.DISCONNECT, async (reason: any) => {
          console.log('disconnect', reason);
          const prevSockets = await this._cacheService.getObject(
            `socket_${socket.data.id_user}`,
          );
          const updatedSockets = !!prevSockets
            ? (prevSockets as string[]).filter(
                (socketId) => socketId !== socket.id,
              )
            : [];

          if (updatedSockets.length) {
            await this._cacheService.setObject(
              `socket_${socket.data.id_user}`,
              updatedSockets,
            );
          } else {
            await this._cacheService.deleteObject(
              `socket_${socket.data.id_user}`,
            );
          }
        });
      });
    }
  }

  async emitEvent(eventName: string, params: unknown, callback?: () => void) {
    //
  }
}
