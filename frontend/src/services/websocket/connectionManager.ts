import { getWebSocketConfig, getWebSocketDebugInfo, validateWebSocketUrl } from "@/config/websocket";
import { io, Socket } from "socket.io-client";

export class ConnectionManager {
  private socket: Socket | null = null;

  async connect(token?: string): Promise<Socket> {
    return this.connectToBackend(token);
  }

  async connectToBackend(token?: string): Promise<Socket> {
    const wsConfig = getWebSocketConfig();
    
    if (!wsConfig.url) {
      throw new Error("WebSocket URL not configured");
    }

    if (!validateWebSocketUrl(wsConfig.url)) {
      console.error("Invalid WebSocket URL format:", wsConfig.url);
      // Log debug info for troubleshooting
      console.debug("WebSocket Debug Info:", getWebSocketDebugInfo());
      throw new Error("Invalid WebSocket URL format");
    }

    const socketOptions: any = {
      ...wsConfig.options,
    };

    if (token) {
      socketOptions.auth = { token };
    }

    // Log connection attempt for debugging
    if (import.meta.env.DEV) {
      console.log("Attempting WebSocket connection to:", wsConfig.url);
      console.debug("Connection options:", socketOptions);
    }

    this.socket = io(wsConfig.url, socketOptions);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error("WebSocket connection timeout to:", wsConfig.url);
        reject(new Error(`Connection timeout to ${wsConfig.url}`));
      }, wsConfig.options.timeout);

      this.socket!.on("connect", () => {
        clearTimeout(timeout);
        if (import.meta.env.DEV) {
          console.log("WebSocket connected successfully to:", wsConfig.url);
        }
        resolve(this.socket!);
      });

      this.socket!.on("connect_error", (error) => {
        clearTimeout(timeout);
        console.error("WebSocket connection error:", error.message);
        console.debug("Failed URL:", wsConfig.url);
        console.debug("Debug Info:", getWebSocketDebugInfo());
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
