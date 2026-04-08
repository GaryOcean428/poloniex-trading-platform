import { Socket as _Socket } from "socket.io-client";

declare global {
  namespace SocketIOClient {
    type Socket = _Socket;
  }
}

export {};