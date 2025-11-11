import { io, Socket } from 'socket.io-client';
import { getBackendUrl } from '@/utils/environment';
import { AutonomousStrategy } from './autonomousTradingAPI';

// Autonomous Trading WebSocket Events
export const AUTONOMOUS_TRADING_EVENTS = {
  // System Events
  GENERATION_COMPLETE: 'generationComplete',
  SYSTEM_STATUS_UPDATE: 'systemStatusUpdate',
  EMERGENCY_STOP: 'emergencyStop',
  
  // Strategy Events
  STRATEGY_CREATED: 'strategyCreated',
  STRATEGY_PROMOTED: 'livePromotionCompleted',
  STRATEGY_RETIRED: 'strategyRetired',
  BACKTEST_COMPLETED: 'backtestCompleted',
  PAPER_TRADING_STARTED: 'paperTradingStarted',
  PAPER_TRADING_EVALUATED: 'paperTradingEvaluated',
  
  // Banking Events
  PROFIT_BANKED: 'profitBanked',
  BANKING_FAILED: 'bankingFailed',
  BANKING_TOGGLED: 'bankingToggled',
  
  // Configuration Events
  CONFIG_UPDATED: 'configUpdated',
  RISK_TOLERANCE_UPDATED: 'riskToleranceUpdated',
  THRESHOLDS_UPDATED: 'thresholdsUpdated',
  
  // Performance Events
  PERFORMANCE_UPDATE: 'performanceUpdate',
  CONFIDENCE_SCORE_CALCULATED: 'confidenceScoreCalculated',
  MARKET_CONDITIONS_UPDATED: 'marketConditionsUpdated',
  RISK_ASSESSMENT_ALERT: 'riskAssessmentAlert',
  
  // Session Events
  SESSION_CREATED: 'sessionCreated',
  SESSION_STARTED: 'sessionStarted',
  SESSION_STOPPED: 'sessionStopped',
  SESSION_UPDATE: 'sessionUpdate',
  POSITION_OPENED: 'positionOpened',
  POSITION_CLOSED: 'positionClosed'
};

// Event payload types
export interface GenerationCompleteEvent {
  generation: number;
  totalStrategies: number;
  activeStrategies: number;
  performance: {
    totalProfit: number;
    totalTrades: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    bankedProfits: number;
  };
}

export interface ProfitBankedEvent {
  amount: number;
  totalBanked: number;
  totalProfit: number;
  transferId: string;
}

export interface StrategyEvent {
  strategyId: string;
  strategy?: AutonomousStrategy;
  confidenceScore?: number;
  reason?: string;
  performance?: unknown;
}

export interface BacktestCompletedEvent {
  strategyId: string;
  result: unknown;
  evaluation: unknown;
  passed: boolean;
}

export interface EmergencyStopEvent {
  drawdown: number;
  currentBalance: number;
  initialBalance: number;
  reason?: string;
}

export interface RiskAssessmentAlert {
  strategyName: string;
  symbol: string;
  riskLevel: string;
  change: string;
}

// Event listener types
export type EventListener = (data: unknown) => void;

// Connection state
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed'
}

// Authentication helper
const getAuthToken = (): string | null => {
  return localStorage.getItem('access_token') || localStorage.getItem('auth_token') || sessionStorage.getItem('token');
};

class AutonomousTradingWebSocket {
  private static instance: AutonomousTradingWebSocket;
  private socket: Socket | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private listeners: Map<string, Set<EventListener>> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isConnecting: boolean = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    // Initialize event listener maps
    Object.values(AUTONOMOUS_TRADING_EVENTS).forEach(event => {
      this.listeners.set(event, new Set());
    });
  }

  public static getInstance(): AutonomousTradingWebSocket {
    if (!AutonomousTradingWebSocket.instance) {
      AutonomousTradingWebSocket.instance = new AutonomousTradingWebSocket();
    }
    return AutonomousTradingWebSocket.instance;
  }

  // Connection Management
  public connect(): void {
    if (this.isConnecting || this.connectionState === ConnectionState.CONNECTED) {
      return;
    }

    this.isConnecting = true;
    this.connectionState = ConnectionState.CONNECTING;
    this.notifyListeners('connectionStateChanged', this.connectionState);

    try {
      const token = getAuthToken();
      const backendUrl = getBackendUrl();

      this.socket = io(backendUrl, {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: false, // We'll handle reconnection manually
        forceNew: true
      });

      this.setupEventHandlers();
      this.startConnectionTimeout();

    } catch {
      // console.error('Error connecting to autonomous trading WebSocket:', _error);
      this.handleConnectionError();
    }
  }

  public disconnect(): void {
    this.isConnecting = false;
    this.connectionState = ConnectionState.DISCONNECTED;
    this.reconnectAttempts = 0;

    this.clearTimers();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.notifyListeners('connectionStateChanged', this.connectionState);
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  // Event Management
  public on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: EventListener): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(listener);
    }
  }

  public removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.get(event)?.clear();
    } else {
      this.listeners.forEach(listenerSet => listenerSet.clear());
    }
  }

  // Private Methods
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      // console.log('Connected to autonomous trading WebSocket');
      this.connectionState = ConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.clearTimers();
      this.startPingTimer();
      this.notifyListeners('connectionStateChanged', this.connectionState);
    });

    this.socket.on('disconnect', (_reason: string) => {
      // console.log('Disconnected from autonomous trading WebSocket:', reason);
      this.connectionState = ConnectionState.DISCONNECTED;
      this.clearTimers();
      this.notifyListeners('connectionStateChanged', this.connectionState);
      
      // Attempt reconnection if not manually disconnected
      if (_reason !== 'client namespace disconnect') {
        this.scheduleReconnect();
      }
    });

    this.socket.on('connect_error', () => {
      // console.error('Connection error');
      this.handleConnectionError();
    });

    // Autonomous Trading Events
    this.socket.on(AUTONOMOUS_TRADING_EVENTS.GENERATION_COMPLETE, (data: GenerationCompleteEvent) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.GENERATION_COMPLETE, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.PROFIT_BANKED, (data: ProfitBankedEvent) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.PROFIT_BANKED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.BANKING_FAILED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.BANKING_FAILED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.STRATEGY_PROMOTED, (data: StrategyEvent) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.STRATEGY_PROMOTED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.STRATEGY_RETIRED, (data: StrategyEvent) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.STRATEGY_RETIRED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.BACKTEST_COMPLETED, (data: BacktestCompletedEvent) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.BACKTEST_COMPLETED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.PAPER_TRADING_STARTED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.PAPER_TRADING_STARTED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.EMERGENCY_STOP, (data: EmergencyStopEvent) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.EMERGENCY_STOP, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.CONFIDENCE_SCORE_CALCULATED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.CONFIDENCE_SCORE_CALCULATED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.MARKET_CONDITIONS_UPDATED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.MARKET_CONDITIONS_UPDATED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.RISK_ASSESSMENT_ALERT, (data: RiskAssessmentAlert) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.RISK_ASSESSMENT_ALERT, data);
    });

    // Paper Trading Events
    this.socket.on(AUTONOMOUS_TRADING_EVENTS.SESSION_CREATED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.SESSION_CREATED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.SESSION_STARTED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.SESSION_STARTED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.SESSION_STOPPED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.SESSION_STOPPED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.SESSION_UPDATE, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.SESSION_UPDATE, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.POSITION_OPENED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.POSITION_OPENED, data);
    });

    this.socket.on(AUTONOMOUS_TRADING_EVENTS.POSITION_CLOSED, (data: unknown) => {
      this.notifyListeners(AUTONOMOUS_TRADING_EVENTS.POSITION_CLOSED, data);
    });

    // Ping/Pong for connection health
    this.socket.on('pong', () => {
      // Connection is healthy
    });
  }

  private notifyListeners(event: string, data: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch {
          // console.error(`Error in listener for event ${event}`);
        }
      });
    }
  }
  

  private handleConnectionError(): void {
    this.isConnecting = false;
    this.connectionState = ConnectionState.FAILED;
    this.clearTimers();
    this.notifyListeners('connectionStateChanged', this.connectionState);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // console.warn('Max reconnection attempts reached');
      this.connectionState = ConnectionState.FAILED;
      this.notifyListeners('connectionStateChanged', this.connectionState);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    // console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.connectionState !== ConnectionState.CONNECTED) {
        this.connectionState = ConnectionState.RECONNECTING;
        this.notifyListeners('connectionStateChanged', this.connectionState);
        this.connect();
      }
    }, delay);
  }

  private startConnectionTimeout(): void {
    this.connectionTimeout = setTimeout(() => {
      if (this.connectionState === ConnectionState.CONNECTING) {
        // console.warn('Connection timeout');
        this.handleConnectionError();
      }
    }, 10000);
  }

  private startPingTimer(): void {
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('ping');
      }
    }, 30000);
  }

  private clearTimers(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  // Utility Methods
  public isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}

// Export singleton instance
export const autonomousTradingWebSocket = AutonomousTradingWebSocket.getInstance();
export default autonomousTradingWebSocket;