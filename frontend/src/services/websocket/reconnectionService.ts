import {
  ConnectionState,
  ReconnectionStrategy,
  ConnectionStats,
} from "@/types/websocketTypes";

export class ReconnectionService {
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private initialReconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  // Current delay for reconnection attempts (for future use)
  // private _currentReconnectDelay: number = this.initialReconnectDelay;
  private reconnectionJitter: number = 0.5;
  private reconnectionStrategy: ReconnectionStrategy =
    ReconnectionStrategy.EXPONENTIAL_BACKOFF;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionStats: ConnectionStats = {
    connectTime: null,
    disconnectTime: null,
    lastPingTime: null,
    lastPongTime: null,
    pingLatency: null,
    reconnectAttempts: 0,
    successfulReconnects: 0,
    failedReconnects: 0,
    totalDisconnects: 0,
    connectionUptime: 0,
    connectionDowntime: 0,
  };

  constructor(
    private onReconnect: () => Promise<void>,
    private onConnectionFailed: () => void
  ) {}

  /**
   * Calculate next reconnect delay based on strategy
   */
  calculateReconnectDelay(): number {
    let delay: number;

    switch (this.reconnectionStrategy) {
      case ReconnectionStrategy.EXPONENTIAL_BACKOFF:
        // Exponential backoff with jitter: delay = min(initialDelay * 2^attempts, maxDelay) * (1 ± jitter)
        delay = Math.min(
          this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
          this.maxReconnectDelay
        );
        break;

      case ReconnectionStrategy.LINEAR_BACKOFF:
        // Linear backoff with jitter: delay = min(initialDelay * attempts, maxDelay) * (1 ± jitter)
        delay = Math.min(
          this.initialReconnectDelay * (this.reconnectAttempts + 1),
          this.maxReconnectDelay
        );
        break;

      case ReconnectionStrategy.IMMEDIATE:
        // Immediate reconnection with minimal delay
        delay = 100;
        break;

      case ReconnectionStrategy.NONE:
      default:
        // No automatic reconnection
        return -1;
    }

    // Apply jitter to avoid thundering herd problem
    // Random value between (1 - jitter) and (1 + jitter)
    const jitterFactor = 1 + (Math.random() * 2 - 1) * this.reconnectionJitter;

    return Math.floor(delay * jitterFactor);
  }

  /**
   * Attempt to reconnect to the WebSocket server
   */
  reconnect(): void {
    // Stop any existing reconnect timer
    this.stopReconnectTimer();

    // Check if we've reached the maximum number of reconnect attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(
        `Max reconnection attempts (${this.maxReconnectAttempts}) reached, staying in mock mode`
      );
      this.connectionStats.failedReconnects++;
      this.onConnectionFailed();
      return;
    }

    // Calculate delay for next reconnect attempt
    const delay = this.calculateReconnectDelay();

    // If delay is negative, don't reconnect
    if (delay < 0) {
      // console.log("Reconnection strategy is NONE, not attempting to reconnect");
      this.onConnectionFailed();
      return;
    }

    // Update state and stats
    this.reconnectAttempts++;
    this.connectionStats.reconnectAttempts++;

    console.log(
      `Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    // Schedule reconnect attempt
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.onReconnect();
        this.connectionStats.successfulReconnects++;
        this.resetReconnectAttempts();
      } catch (error) {
        // console.log("Reconnect attempt failed:", error);
        this.connectionStats.failedReconnects++;
        // Continue with reconnection attempts
        this.reconnect();
      }
    }, delay);
  }

  /**
   * Stop reconnect timer
   */
  stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Reset reconnect attempts counter
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
    // this._currentReconnectDelay = this.initialReconnectDelay;
  }

  /**
   * Update connection statistics
   */
  updateConnectionStats(stats: Partial<ConnectionStats>): void {
    this.connectionStats = { ...this.connectionStats, ...stats };
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    // Update uptime/downtime calculations
    const now = Date.now();
    if (this.connectionStats.connectTime) {
      this.connectionStats.connectionUptime =
        now - this.connectionStats.connectTime;
    } else if (this.connectionStats.disconnectTime) {
      this.connectionStats.connectionDowntime =
        now - this.connectionStats.disconnectTime;
    }

    return { ...this.connectionStats };
  }

  /**
   * Get current reconnect attempts
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Set reconnection strategy
   */
  setReconnectionStrategy(strategy: ReconnectionStrategy): void {
    this.reconnectionStrategy = strategy;
  }

  /**
   * Set reconnection parameters
   */
  setReconnectionParameters(params: {
    maxReconnectAttempts?: number;
    initialReconnectDelay?: number;
    maxReconnectDelay?: number;
    reconnectionJitter?: number;
  }): void {
    if (params.maxReconnectAttempts !== undefined) {
      this.maxReconnectAttempts = params.maxReconnectAttempts;
    }
    if (params.initialReconnectDelay !== undefined) {
      this.initialReconnectDelay = params.initialReconnectDelay;
    }
    if (params.maxReconnectDelay !== undefined) {
      this.maxReconnectDelay = params.maxReconnectDelay;
    }
    if (params.reconnectionJitter !== undefined) {
      this.reconnectionJitter = params.reconnectionJitter;
    }
  }

  /**
   * Handle connection failure
   */
  handleConnectionFailure(): void {
    this.connectionStats.totalDisconnects++;
    this.connectionStats.disconnectTime = Date.now();
    this.reconnect();
  }

  /**
   * Handle successful connection
   */
  handleSuccessfulConnection(): void {
    this.connectionStats.connectTime = Date.now();
    this.resetReconnectAttempts();
  }

  /**
   * Get connection health information
   */
  getConnectionHealth(): {
    state: ConnectionState;
    isHealthy: boolean;
    uptime: number;
    lastPing: number;
    latency: number | null;
    reconnectAttempts: number;
  } {
    const now = Date.now();
    const uptime = this.connectionStats.connectTime
      ? now - this.connectionStats.connectTime
      : 0;

    return {
      state: this.reconnectAttempts > 0 ? ConnectionState.RECONNECTING : ConnectionState.CONNECTED,
      isHealthy: this.reconnectAttempts === 0,
      uptime,
      lastPing: this.connectionStats.lastPingTime || 0,
      latency: this.connectionStats.pingLatency,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Force stop all reconnection attempts
   */
  forceStop(): void {
    this.stopReconnectTimer();
    this.reconnectAttempts = 0;
    // this._currentReconnectDelay = this.initialReconnectDelay;
  }
}
