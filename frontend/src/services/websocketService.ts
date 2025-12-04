import {
  ConnectionState,
  ConnectionStats,
  WebSocketServiceInterface,
} from "@/types/websocketTypes";
import {
  _getPoloniexApiKey,
  _getPoloniexApiSecret,
  shouldUseMockMode,
} from "@/utils/environment";
import React from "react";
import { ConnectionManager } from "./websocket/connectionManager";
import { EventHandlerService } from "./websocket/eventHandlerService";
// import { ClientWebSocketEvents, PoloniexTopics } from "@/types/websocketTypes";
import { HealthService } from "./websocket/healthService";
import { ReconnectionService } from "./websocket/reconnectionService";

// Removed unused POLONIEX_V3_CONFIG constant

class WebSocketService implements WebSocketServiceInterface {
  private static instance: WebSocketService;
  private connectionManager: ConnectionManager;
  private reconnectionService: ReconnectionService;
  private eventHandlerService: EventHandlerService;
  private healthService: HealthService;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private useMockData: boolean = true;

  private constructor() {
    this.connectionManager = new ConnectionManager();
    this.reconnectionService = new ReconnectionService(
      this.reconnect.bind(this),
      this.handleConnectionFailed.bind(this)
    );
    this.eventHandlerService = new EventHandlerService(null, null);
    this.healthService = new HealthService(null, null);

    this.initializeService();
  }

  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  private initializeService(): void {
    // Determine connection strategy
    // Note: Frontend no longer uses API keys directly - all auth goes through backend
    const hasCredentials = false; // Always use backend authentication
    this.useMockData = shouldUseMockMode(hasCredentials);

    // console.log("WebSocket Service V3 initialized:", {
    //   usePoloniexDirect: !this.useMockData && hasCredentials,
    //   useMockData: this.useMockData,
    //   hasCredentials,
    // });

    // Load offline data
    this.eventHandlerService.loadOfflineData();

    // Listen for online/offline events
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline.bind(this));
      window.addEventListener("offline", this.handleOffline.bind(this));
      window.addEventListener("beforeunload", this.cleanup.bind(this));
    }
  }

  private handleOnline(): void {
    // console.log("Device is online, attempting to reconnect WebSocket");
    if (
      this.connectionState === ConnectionState.DISCONNECTED ||
      this.connectionState === ConnectionState.FAILED
    ) {
      this.connect();
    }
  }

  private handleOffline(): void {
    // console.log("Device is offline, WebSocket connection will be affected");
    if (this.connectionState === ConnectionState.CONNECTED) {
      this.connectionState = ConnectionState.DISCONNECTED;
    }
  }

  private cleanup(): void {
    this.healthService.stopPingTimer();
    this.healthService.stopPoloniexV3PingTimer();
    this.reconnectionService.forceStop();
    this.disconnect();
  }

  private async reconnect(): Promise<void> {
    // console.error("Reconnection failed:", error);
    await this.connect();
  }

  private handleConnectionFailed(): void {
    // console.log("Connection failed, switching to mock mode");
    this.useMockData = true;
    this.connectionState = ConnectionState.FAILED;
  }

  async connect(token?: string): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) {
      return;
    }

    if (this.connectionState === ConnectionState.CONNECTING) {
      return;
    }

    this.connectionState = ConnectionState.CONNECTING;
    this.reconnectionService.updateConnectionStats({ connectTime: Date.now() });

    try {
      if (this.connectionManager.isUsingPoloniexDirect()) {
        await this.connectToPoloniexV3();
      } else {
        await this.connectToBackend(token);
      }
    } catch (_error) {
      // console.error("Connection failed, using mock mode:", error);
      this.useMockData = true;
      this.connectionState = ConnectionState.FAILED;
    }
  }

  private async connectToPoloniexV3(): Promise<void> {
    const ws = await this.connectionManager.connect();

    this.eventHandlerService = new EventHandlerService(null, ws);
    this.healthService = new HealthService(null, ws);

    this.eventHandlerService.setupSocketIOHandlers();
    this.healthService.startPoloniexV3PingTimer();

    this.connectionState = ConnectionState.CONNECTED;
    this.useMockData = false;

    // console.log("Connected to Poloniex V3 WebSocket");
  }

  private async connectToBackend(token?: string): Promise<void> {
    const socket = await this.connectionManager.connectToBackend(token);

    this.eventHandlerService = new EventHandlerService(null, socket);
    this.healthService = new HealthService(null, socket);

    this.eventHandlerService.setupSocketIOHandlers();
    this.healthService.startPingTimer();

    this.connectionState = ConnectionState.CONNECTED;
    this.useMockData = false;

    // console.log("Connected to backend WebSocket");
  }

  disconnect(): void {
    this.connectionManager.disconnect();
    this.healthService.stopPingTimer();
    this.healthService.stopPoloniexV3PingTimer();
    this.reconnectionService.forceStop();
    this.connectionState = ConnectionState.DISCONNECTED;
  }

  isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  isMockMode(): boolean {
    return this.useMockData;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getConnectionStats(): ConnectionStats {
    return this.reconnectionService.getConnectionStats();
  }

  subscribeToMarket(pair: string): void {
    this.eventHandlerService.subscribeToMarket(pair);
  }

  unsubscribeFromMarket(pair: string): void {
    this.eventHandlerService.unsubscribeFromMarket(pair);
  }

  send(event: string, data: unknown): void {
    this.eventHandlerService.send(event, data);
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.eventHandlerService.on(event, callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.eventHandlerService.off(event, callback);
  }

  subscribeToPoloniexV3(topic: string, symbols?: string[]): void {
    this.eventHandlerService.subscribeToPoloniexV3(topic, symbols);
  }

  unsubscribeFromPoloniexV3(topic: string): void {
    this.eventHandlerService.unsubscribeFromPoloniexV3(topic);
  }

  getConnectionHealth() {
    return this.healthService.getConnectionHealth();
  }

  getConnectionStatus() {
    return this.healthService.getConnectionStatus();
  }

  // React hook for monitoring connection state
  useConnectionState() {
    const [state, setState] = React.useState(this.connectionState);
    const [isMock, setIsMock] = React.useState(this.useMockData);

    React.useEffect(() => {
      const handleStateChange = (...args: unknown[]) => {
        const newState = args[0] as ConnectionState;
        setState(newState);
        setIsMock(this.useMockData);
      };

      this.on("connectionStateChanged", handleStateChange);

      return () => {
        this.off("connectionStateChanged", handleStateChange);
      };
    }, []);

    return {
      connectionState: state,
      isMockMode: isMock,
      isConnected: this.isConnected(),
      connect: this.connect.bind(this),
      disconnect: this.disconnect.bind(this),
    };
  }
}

// Export singleton instance
export const webSocketService = WebSocketService.getInstance();

// Hook for using WebSocket in React components
export const useWebSocket = () => {
  const service = WebSocketService.getInstance();
  return {
    connectionState: service.useConnectionState(),
    isConnected: service.isConnected(),
    isMockMode: service.isMockMode(),
    connect: service.connect.bind(service),
    disconnect: service.disconnect.bind(service),
    subscribe: service.subscribeToMarket.bind(service),
    unsubscribe: service.unsubscribeFromMarket.bind(service),
    send: service.send.bind(service),
    on: service.on.bind(service),
    off: service.off.bind(service),
    getStats: service.getConnectionStats.bind(service),
    getHealth: service.getConnectionHealth.bind(service),
    subscribeToV3: service.subscribeToPoloniexV3.bind(service),
    unsubscribeFromV3: service.unsubscribeFromPoloniexV3.bind(service),
  };
};

// Re-export types for convenience
export { ConnectionState } from "@/types/websocketTypes";
