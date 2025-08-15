import { Socket } from "socket.io-client";

declare global {
  namespace SocketIOClient {
    type Socket = Socket;
  }
}

export {};