/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from 'socket.io';
import { inject, injectable } from 'inversify';
import http from 'http';
import { SocketDefaultEventsMap } from '../types/user';
import { TYPES } from '../ContainerTypes';
import { ICacheService } from '../interfaces/ICacheService';
import { Handshake } from 'socket.io/dist/socket';
import loggedUser from '../api/middlewares/auth';
import { ILibraryService } from '../interfaces/ILibraryService';

enum SocketStates {
  CONNECTION = 'connection',
  DISCONNECT = 'disconnect',
}
enum SocketEvents {
  TRACK_UPDATE = 'track_update',
}
@injectable()
export class SocketService {
  @inject(TYPES.CacheService) private _cacheService: ICacheService;
  @inject(TYPES.LibraryService) private _libraryService: ILibraryService;
  private socketServer: Server<
    SocketDefaultEventsMap,
    SocketDefaultEventsMap,
    SocketDefaultEventsMap,
    any
  >;

  authValidation(handshake: Handshake): { id_user: number; email: string } {
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
        email: req.user.email,
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
            ...user,
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

        socket.on(SocketEvents.TRACK_UPDATE, (itemData: any) => {
          const itemDataParsed = JSON.parse(itemData.data);
          console.log(socket.data, itemDataParsed);
          new Promise(async (resolve) => {
            await this._libraryService.UpdateObject(
              {
                id_user: socket.data.id_user,
                email: socket.data.email,
              },
              itemDataParsed.relativePath,
              itemDataParsed,
            );
            resolve(true);
          });
        });
      });
    }
  }

  async emitEvent(eventName: string, params: unknown, callback?: () => void) {
    //
  }
}
