import { getBackendUrl } from "@/utils/environment";
import { io, Socket } from "socket.io-client";

export class ConnectionManager {
  private socket: Socket | null = null;

  async connectToBackend(token?: string): Promise<Socket> {
    const backendUrl = getBackendUrl();

    if (!backendUrl) {
      throw new Error("Backend URL not configured");
    }

    const socketOptions: any = {
      transports: ["websocket", "polling"],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    };

    if (token) {
      socketOptions.auth = { token };
    }

    this.socket = io(backendUrl, socketOptions);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      this.socket!.on("connect", () => {
        clearTimeout(timeout);
        resolve(this.socket!);
      });

      this.socket!.on("connect_error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${error.message}`));
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return !!(this.socket && this.socket.connected);
  }

  isUsingPoloniexDirect(): boolean {
    return false; // Always use backend proxy
  }

  getConnectionInfo(): {
    isConnected: boolean;
    isUsingPoloniexDirect: boolean;
    socket: Socket | null;
  } {
    return {
      isConnected: this.isConnected(),
      isUsingPoloniexDirect: false,
      socket: this.socket,
    };
  }
}
