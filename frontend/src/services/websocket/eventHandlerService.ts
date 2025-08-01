import {
  MarketData,
  SubscriptionMessage,
  Trade,
  WebSocketMessage,
  ClientWebSocketEvents,
  PoloniexTopics,
} from "@/types/websocketTypes";

export class EventHandlerService {
  private eventListeners: Map<string, Set<(...args: unknown[]) => void>> =
    new Map();
  private subscriptions: Set<string> = new Set();
  private pendingMessages: Array<{ event: string; data: unknown }> = [];
  private offlineData: Map<string, unknown> = new Map();

  constructor(
    private poloniexWs: WebSocket | null,
    private socket: SocketIOClient.Socket | null
  ) {}

  /**
   * Register an event listener
   */
  on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }

    this.eventListeners.get(event)?.add(callback);
  }

  /**
   * Remove an event listener
   */
  off(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) return;

    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Notify all listeners for a specific event
   */
  notifyListeners(event: string, data: unknown): void {
    // Save data for offline access if it's a data event
    if (
      event === ClientWebSocketEvents.MARKET_DATA ||
      event === ClientWebSocketEvents.TRADE_EXECUTED ||
      event === ClientWebSocketEvents.TICKER_UPDATE
    ) {
      this.saveOfflineData(event, data);
    }

    this.eventListeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(
          `Error in ${event} event listener:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    });
  }

  /**
   * Save data for offline access
   */
  private saveOfflineData(key: string, data: unknown): void {
    try {
      this.offlineData.set(key, data);
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "websocket_offline_data",
          JSON.stringify(Array.from(this.offlineData.entries()))
        );
      }
    } catch (error) {
      console.error("Error saving offline data:", error);
    }
  }

  /**
   * Load offline data
   */
  loadOfflineData(): void {
    try {
      if (typeof window !== "undefined") {
        const savedData = localStorage.getItem("websocket_offline_data");
        if (savedData) {
          this.offlineData = new Map(
            JSON.parse(savedData) as [string, unknown][]
          );
        }
      }
    } catch (error) {
      console.error("Error loading offline data:", error);
    }
  }

  /**
   * Get offline data for a specific key
   */
  getOfflineData(key: string): unknown {
    return this.offlineData.get(key);
  }

  /**
   * Subscribe to market data for a specific pair
   */
  subscribeToMarket(pair: string): void {
    // Add to subscriptions set
    this.subscriptions.add(pair);

    if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
      // For Poloniex direct connection
      const subscribeMessage: SubscriptionMessage = {
        id: Date.now(),
        type: "subscribe",
        topic: PoloniexTopics.TICKER_V2,
        symbols: [pair.replace("-", "_")],
        privateChannel: false,
        response: true,
      };
      this.poloniexWs.send(JSON.stringify(subscribeMessage));
    } else if (this.socket) {
      // For backend Socket.IO connection
      this.socket.emit("subscribeMarket", { pair });
    }
  }

  /**
   * Unsubscribe from market data for a specific pair
   */
  unsubscribeFromMarket(pair: string): void {
    // Remove from subscriptions set
    this.subscriptions.delete(pair);

    if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
      // For Poloniex direct connection
      const unsubscribeMessage: SubscriptionMessage = {
        id: Date.now(),
        type: "unsubscribe",
        topic: "/contractMarket/tickerV2",
        symbols: [pair.replace("-", "_")],
        response: true,
      };
      this.poloniexWs.send(JSON.stringify(unsubscribeMessage));
    } else if (this.socket) {
      // For backend Socket.IO connection
      this.socket.emit("unsubscribeMarket", { pair });
    }
  }

  /**
   * Send a message to the server
   */
  send(event: string, data: unknown): void {
    if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
      // For Poloniex direct connection, send as JSON
      const message = { event, ...(data || {}) };
      this.poloniexWs.send(JSON.stringify(message));
    } else if (this.socket) {
      // For backend Socket.IO connection
      this.socket.emit(event, data);
    } else {
      // Queue message to be sent when connection is established
      this.pendingMessages.push({ event, data });
    }
  }

  /**
   * Resubscribe to previous subscriptions after reconnect
   */
  resubscribe(): void {
    // console.log(`Resubscribing to ${this.subscriptions.size} channels`);

    this.subscriptions.forEach((subscription) => {
      if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
        // For Poloniex direct connection
        const subscribeMessage: SubscriptionMessage = {
          id: Date.now(),
          type: "subscribe",
          topic: "/contractMarket/tickerV2",
          symbols: [subscription.replace("-", "_")],
          privateChannel: false,
          response: true,
        };
        this.poloniexWs.send(JSON.stringify(subscribeMessage));
      } else if (this.socket) {
        // For backend Socket.IO connection
        this.socket.emit("subscribeMarket", { pair: subscription });
      }
    });
  }

  /**
   * Send any pending messages after reconnect
   */
  sendPendingMessages(): void {
    // console.log(`Sending ${this.pendingMessages.length} pending messages`);

    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        this.send(message.event, message.data);
      }
    }
  }

  /**
   * Subscribe to Poloniex V3 market data
   */
  subscribeToPoloniexV3(topic: string, symbols?: string[]): void {
    if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
      const subscribeMessage: SubscriptionMessage = {
        id: Date.now(),
        type: "subscribe",
        topic,
        symbols: symbols || [],
        privateChannel: false,
        response: true,
      };
      this.poloniexWs.send(JSON.stringify(subscribeMessage));
    }
  }

  /**
   * Unsubscribe from Poloniex V3 market data
   */
  unsubscribeFromPoloniexV3(topic: string): void {
    if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
      const unsubscribeMessage: SubscriptionMessage = {
        id: Date.now(),
        type: "unsubscribe",
        topic,
        response: true,
      };
      this.poloniexWs.send(JSON.stringify(unsubscribeMessage));
    }
  }

  /**
   * Handle Poloniex V3 WebSocket messages
   */
  handlePoloniexV3Message(data: WebSocketMessage): void {
    try {
      // Handle different message types from Poloniex V3
      switch (data.type) {
        case "message":
          this.handlePoloniexV3DataMessage(data);
          break;
        case "welcome":
          // console.log("Poloniex V3 welcome message:", data);
          break;
        case "pong":
          // console.log("Poloniex V3 pong received");
          break;
        case "error":
          console.error("Poloniex V3 error:", data);
          break;
        default:
          // console.log("Unknown Poloniex V3 message type:", data.type);
      }
    } catch (error) {
      console.error("Error handling Poloniex V3 message:", error);
    }
  }

  /**
   * Handle Poloniex V3 data messages
   */
  private handlePoloniexV3DataMessage(data: WebSocketMessage): void {
    try {
      const topic = data.topic;

      if (topic === "/contractMarket/tickerV2") {
        // Handle ticker data
        const tickerData = data.data as any;
        if (tickerData) {
          const marketData: MarketData = {
            pair:
              (tickerData.symbol as string)?.replace("_", "-") || "BTC-USDT",
            timestamp: Date.now(),
            open: parseFloat(tickerData.open as string) || 0,
            high: parseFloat(tickerData.high as string) || 0,
            low: parseFloat(tickerData.low as string) || 0,
            close: parseFloat(tickerData.price as string) || 0,
            volume: parseFloat(tickerData.volume as string) || 0,
          };

          this.notifyListeners("marketData", marketData);
        }
      } else if (topic === "/contractMarket/execution") {
        // Handle trade execution data
        const tradeData = data.data as any;
        if (tradeData) {
          const trade: Trade = {
            id: tradeData.tradeId as string,
            pair: (tradeData.symbol as string)?.replace("_", "_") || "BTC-USDT",
            price: parseFloat(tradeData.price as string) || 0,
            amount: parseFloat(tradeData.size as string) || 0,
            side: ((tradeData.side as string)?.toLowerCase() === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
            timestamp: (tradeData.ts as number) || Date.now(),
          };

          this.notifyListeners("tradeExecuted", trade);
        }
      } else if (topic === "/contractMarket/level2") {
        // Handle order book updates
        this.notifyListeners("orderBookUpdate", data.data);
      } else if (topic === "/contractMarket/level3") {
        // Handle full order book
        this.notifyListeners("fullOrderBook", data.data);
      }
    } catch (error) {
      console.error("Error handling Poloniex V3 data message:", error);
    }
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupSocketIOHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      // console.log("Socket.IO connected");
      this.notifyListeners("connectionStateChanged", "connected");
    });

    this.socket.on("disconnect", (reason: unknown) => {
      // console.log("Socket.IO disconnected:", reason);
      this.notifyListeners("connectionStateChanged", "disconnected");
    });

    this.socket.on("marketData", (data: MarketData) => {
      this.notifyListeners("marketData", data);
    });

    this.socket.on("tradeExecuted", (data: Trade) => {
      this.notifyListeners("tradeExecuted", data);
    });

    this.socket.on("error", (error: Error) => {
      console.error("Socket.IO error:", error);
      this.notifyListeners("error", error);
    });
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Clear all subscriptions
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
  }

  /**
   * Get event listeners count
   */
  getEventListenersCount(event: string): number {
    return this.eventListeners.get(event)?.size || 0;
  }

  /**
   * Get all event listeners
   */
  getAllEventListeners(): Map<string, Set<(...args: unknown[]) => void>> {
    return new Map(this.eventListeners);
  }
}
