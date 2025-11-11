import axios, { AxiosInstance } from 'axios';
import { getBackendUrl } from '@/utils/environment';

// Types for autonomous trading API
export interface AutonomousSystemStatus {
  isRunning: boolean;
  generationCount: number;
  totalStrategies: number;
  activeStrategies: number;
  performanceMetrics: {
    totalProfit: number;
    totalTrades: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    bankedProfits: number;
  };
  optimizationStats: {
    backtestsCompleted: number;
    paperTradingPromotions: number;
    livePromotions: number;
    retirements: number;
  };
  bankingStats: {
    totalBanked: number;
    totalTransfers: number;
    averageTransferSize: number;
    lastBankingTime: string | null;
    failedTransfers: number;
  };
}

export interface AutonomousStrategy {
  id: string;
  name: string;
  type: string;
  symbol: string;
  timeframe: string;
  indicators: Array<{
    category: string;
    indicator: string;
  }>;
  parameters: Record<string, any>;
  performance: {
    profit: number;
    trades: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    confidence: number;
    backtestScore: number;
    paperTradeScore: number;
    liveTradeScore: number;
  };
  status: string;
  fitness?: number;
  createdAt: string;
  generation: number;
}

export interface RiskToleranceConfig {
  maxDrawdown: number;
  riskPerTrade: number;
  maxPositionSize: number;
  profitBankingPercent: number;
}

export interface BankingConfig {
  enabled: boolean;
  bankingPercentage: number;
  minimumProfitThreshold: number;
  maximumSingleTransfer: number;
  bankingInterval: number;
  emergencyStopThreshold: number;
  maxDailyBanking: number;
}

export interface BankingRecord {
  id: string;
  timestamp: string;
  amount: number;
  totalProfit: number;
  status: 'completed' | 'failed' | 'pending';
  transferId?: string;
  error?: string;
}

export interface PerformanceAnalytics {
  totalProfit: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  bankedProfits: number;
  generationCount: number;
  activeStrategies: number;
}

// Authentication helper
const getAuthToken = (): string | null => {
  return localStorage.getItem('access_token') || localStorage.getItem('auth_token') || sessionStorage.getItem('token');
};

// Create authenticated axios instance
const createAuthenticatedAxios = (): AxiosInstance => {
  const token = getAuthToken();
  return axios.create({
    baseURL: `${getBackendUrl()}/api/autonomous-trading`,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
};

// Custom error classes
export class AutonomousTradingAPIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AutonomousTradingAPIError';
  }
}

export class AutonomousTradingAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutonomousTradingAuthError';
  }
}

// Autonomous Trading API Service
class AutonomousTradingAPIService {
  private static instance: AutonomousTradingAPIService;

  public static getInstance(): AutonomousTradingAPIService {
    if (!AutonomousTradingAPIService.instance) {
      AutonomousTradingAPIService.instance = new AutonomousTradingAPIService();
    }
    return AutonomousTradingAPIService.instance;
  }

  // System Control Methods
  async startSystem(config?: {
    riskTolerance?: RiskToleranceConfig;
    bankingConfig?: BankingConfig;
  }): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/start', config);
    } catch (error) {
      this.handleError(error);
    }
  }

  async stopSystem(): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/stop');
    } catch (error) {
      this.handleError(error);
    }
  }

  async emergencyStop(reason: string): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/emergency-stop', { reason });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getSystemStatus(): Promise<AutonomousSystemStatus> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/status');
      return response.data.systemStatus;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // Strategy Management Methods
  async getStrategies(params?: {
    status?: string;
    generation?: number;
    limit?: number;
    offset?: number;
  }): Promise<{
    strategies: AutonomousStrategy[];
    total: number;
    limit: number;
    offset: number;
  }> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/strategies', { params });
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async getStrategy(strategyId: string): Promise<AutonomousStrategy> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get(`/strategies/${strategyId}`);
      return response.data.strategy;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async retireStrategy(strategyId: string, reason: string): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post(`/strategies/${strategyId}/retire`, { reason });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getStrategyPerformance(strategyId: string, timeframe: string = '24h'): Promise<any> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get(`/strategies/${strategyId}/performance`, {
        params: { timeframe }
      });
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // Profit Banking Methods
  async getBankingStatus(): Promise<any> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/banking/status');
      return response.data.bankingStats;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async executeBanking(amount: number): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/banking/manual', { amount });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getBankingHistory(limit: number = 50): Promise<BankingRecord[]> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/banking/history', { params: { limit } });
      return response.data.history;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async updateBankingConfig(config: BankingConfig): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/banking/config', { bankingConfig: config });
    } catch (error) {
      this.handleError(error);
    }
  }

  async toggleBanking(enabled: boolean): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/banking/toggle', { enabled });
    } catch (error) {
      this.handleError(error);
    }
  }

  // Configuration Methods
  async getConfig(): Promise<{
    riskTolerance: RiskToleranceConfig;
    generationConfig: unknown;
    bankingConfig: BankingConfig;
    optimizationThresholds: unknown;
  }> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/config');
      return response.data.config;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async updateRiskTolerance(riskTolerance: RiskToleranceConfig): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/config/risk-tolerance', { riskTolerance });
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateOptimizationThresholds(thresholds: unknown): Promise<void> {
    try {
      const api = createAuthenticatedAxios();
      await api.post('/config/optimization-thresholds', { thresholds });
    } catch (error) {
      this.handleError(error);
    }
  }

  // Analytics Methods
  async getPerformanceAnalytics(timeframe: string = '24h'): Promise<PerformanceAnalytics> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/analytics/performance', { params: { timeframe } });
      return response.data.analytics;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async getGenerationStats(limit: number = 10): Promise<any> {
    try {
      const api = createAuthenticatedAxios();
      const response = await api.get('/analytics/generations', { params: { limit } });
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // Error handling helper
  private handleError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new AutonomousTradingAuthError(
          'Authentication failed - please check your credentials'
        );
      }
      if (error.response?.status) {
        throw new AutonomousTradingAPIError(
          `API error: ${error.response.statusText}`,
          error.response.data?.code || 'API_ERROR',
          error.response.status
        );
      }
    }
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    throw new AutonomousTradingAPIError(`Network error: ${message}`);
  }
}

// Export singleton instance
export const autonomousTradingAPI = AutonomousTradingAPIService.getInstance();
export default autonomousTradingAPI;
