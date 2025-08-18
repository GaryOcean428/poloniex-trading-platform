import { ConnectionState, ConnectionStats } from "@/types/websocketTypes";

export class HealthService {
  private pingTimer: NodeJS.Timeout | null = null;
  private poloniexPingTimer: NodeJS.Timeout | null = null;
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

  private PING_INTERVAL = 30000; // 30 seconds
  private PING_TIMEOUT = 10000; // 10 seconds

  constructor(
    private poloniexWs: WebSocket | null,
    private socket: SocketIOClient.Socket | null
  ) {}

  /**
   * Start ping timer to detect connection issues
   */
  startPingTimer(): void {
    this.stopPingTimer();

    this.pingTimer = setInterval(() => {
      this.connectionStats.lastPingTime = Date.now();

      if (this.socket) {
        // For Socket.IO connection
        this.socket.emit("ping", { timestamp: Date.now() });

        // Set timeout for pong response
        setTimeout(() => {
          const lastPongTime = this.connectionStats.lastPongTime || 0;
          const lastPingTime = this.connectionStats.lastPingTime || 0;
          const pongElapsed = Date.now() - Math.max(lastPongTime, lastPingTime);

          // If we haven't received a pong or it's too old
          if (pongElapsed <= 0 || pongElapsed > this.PING_TIMEOUT) {
            // console.warn(`WebSocket ping timeout after ${this.PING_TIMEOUT}ms`);

            // Force disconnect and reconnect
            if (this.socket) {
              this.socket.disconnect();
            }
          }
        }, this.PING_TIMEOUT);
      }
    }, this.PING_INTERVAL);
  }

  /**
   * Start ping timer for Poloniex V3 connection
   */
  startPoloniexV3PingTimer(): void {
    this.stopPoloniexV3PingTimer();

    this.poloniexPingTimer = setInterval(() => {
      if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
        const pingMessage = {
          id: Date.now(),
          type: "ping",
        };
        this.poloniexWs.send(JSON.stringify(pingMessage));
        this.connectionStats.lastPingTime = Date.now();
      }
    }, this.PING_INTERVAL);
  }

  /**
   * Stop ping timer
   */
  stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Stop ping timer for Poloniex V3 connection
   */
  stopPoloniexV3PingTimer(): void {
    if (this.poloniexPingTimer) {
      clearInterval(this.poloniexPingTimer);
      this.poloniexPingTimer = null;
    }
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
      state: ConnectionState.CONNECTED,
      isHealthy: true,
      uptime,
      lastPing: this.connectionStats.lastPingTime || 0,
      latency: this.connectionStats.pingLatency,
      reconnectAttempts: this.connectionStats.reconnectAttempts,
    };
  }

  /**
   * Handle pong response
   */
  handlePong(_timestamp: number): void {
    this.connectionStats.lastPongTime = Date.now();

    if (this.connectionStats.lastPingTime) {
      this.connectionStats.pingLatency =
        this.connectionStats.lastPongTime - this.connectionStats.lastPingTime;
    }
  }

  /**
   * Check if connection is healthy
   */
  isConnectionHealthy(): boolean {
    const now = Date.now();
    const lastPing = this.connectionStats.lastPingTime || 0;
    const lastPong = this.connectionStats.lastPongTime || 0;

    // If we haven't received a pong in the last 2 ping intervals, consider it unhealthy
    if (now - Math.max(lastPing, lastPong) > this.PING_INTERVAL * 2) {
      return false;
    }

    return true;
  }

  /**
   * Get connection status summary
   */
  getConnectionStatus(): {
    connected: boolean;
    uptime: string;
    lastPing: string;
    latency: string;
    health: string;
  } {
    const stats = this.getConnectionStats();
    // Current time for status calculations
    // const now = Date.now();

    return {
      connected: stats.connectTime !== null,
      uptime: this.formatDuration(stats.connectionUptime),
      lastPing: stats.lastPingTime
        ? new Date(stats.lastPingTime).toLocaleTimeString()
        : "Never",
      latency: stats.pingLatency ? `${stats.pingLatency}ms` : "Unknown",
      health: this.isConnectionHealthy() ? "Good" : "Poor",
    };
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  /**
   * Reset connection statistics
   */
  resetConnectionStats(): void {
    this.connectionStats = {
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
  }

  /**
   * Monitor connection health
   */
  monitorConnectionHealth(): void {
    setInterval(() => {
      const health = this.getConnectionHealth();

      if (!this.isConnectionHealthy()) {
        // console.warn("Connection health is poor:", health);
      }
    }, 60000); // Check every minute
  }
}
