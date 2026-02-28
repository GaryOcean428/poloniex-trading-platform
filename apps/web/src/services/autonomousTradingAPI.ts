import axios, { AxiosInstance } from 'axios';
import { getBackendUrl } from '@/utils/environment';
import { getAccessToken } from '@/utils/auth';

// Types for autonomous trading API
export interface AutonomousSystemStatus {
    isRunning: boolean;
    sessionId?: string;
    status?: string;
    startedAt?: string;
    config?: Record<string, any>;
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

export interface AgentSettings {
    runMode: 'never' | 'manual' | 'always';
    autoStartOnLogin: boolean;
    continueWhenLoggedOut: boolean;
    config: Record<string, any>;
}

// Create authenticated axios instance pointing to /api/agent (the real autonomous agent backend)
const createAuthenticatedAxios = (): AxiosInstance => {
    const token = getAccessToken();
    return axios.create({
          baseURL: `${getBackendUrl()}/api/agent`,
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

// Default status when agent is not running
const DEFAULT_STATUS: AutonomousSystemStatus = {
    isRunning: false,
    generationCount: 0,
    totalStrategies: 0,
    activeStrategies: 0,
    performanceMetrics: {
          totalProfit: 0,
          totalTrades: 0,
          winRate: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          bankedProfits: 0,
    },
    optimizationStats: {
          backtestsCompleted: 0,
          paperTradingPromotions: 0,
          livePromotions: 0,
          retirements: 0,
    },
    bankingStats: {
          totalBanked: 0,
          totalTransfers: 0,
          averageTransferSize: 0,
          lastBankingTime: null,
          failedTransfers: 0,
    },
};

// Autonomous Trading API Service - maps to /api/agent/* backend endpoints
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
        enableAIStrategies?: boolean;
  }): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/start with config
          await api.post('/start', { ...config, enableAIStrategies: true });
        } catch (error) {
                this.handleError(error);
        }
  }

  async stopSystem(): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/stop
          await api.post('/stop');
        } catch (error) {
                this.handleError(error);
        }
  }

  async pauseSystem(): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/pause
          await api.post('/pause');
        } catch (error) {
                this.handleError(error);
        }
  }

  async emergencyStop(reason: string): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/stop (emergency)
          await api.post('/stop', { reason, emergency: true });
        } catch (error) {
                this.handleError(error);
        }
  }

  async getSystemStatus(): Promise<AutonomousSystemStatus> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/status
          const response = await api.get('/status');
                const agentStatus = response.data.status;

          if (!agentStatus) {
                    return { ...DEFAULT_STATUS };
          }

          // Map /api/agent/status response to AutonomousSystemStatus shape
          return {
                    isRunning: agentStatus.status === 'running' || agentStatus.status === 'active',
                    sessionId: agentStatus.id,
                    status: agentStatus.status,
                    startedAt: agentStatus.startedAt,
                    config: agentStatus.config,
                    generationCount: agentStatus.generationCount || 0,
                    totalStrategies: agentStatus.totalStrategies || 0,
                    activeStrategies: agentStatus.activeStrategies || 0,
                    performanceMetrics: agentStatus.performanceMetrics || DEFAULT_STATUS.performanceMetrics,
                    optimizationStats: agentStatus.optimizationStats || DEFAULT_STATUS.optimizationStats,
                    bankingStats: agentStatus.bankingStats || DEFAULT_STATUS.bankingStats,
          };
        } catch (error) {
                // Return default status if agent is not running (404 = no session)
          if (axios.isAxiosError(error) && error.response?.status === 404) {
                    return { ...DEFAULT_STATUS };
          }
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
                // GET /api/agent/strategies
          const response = await api.get('/strategies', { params });
                return {
                          strategies: response.data.strategies || [],
                          total: response.data.strategies?.length || 0,
                          limit: params?.limit || 50,
                          offset: params?.offset || 0,
                };
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async getStrategy(strategyId: string): Promise<AutonomousStrategy> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/strategies/:sessionId
          const response = await api.get(`/strategies/${strategyId}`);
                return response.data.strategies?.[0] || response.data.strategy;
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async retireStrategy(strategyId: string, reason: string): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/strategy/:id/retire
          await api.post(`/strategy/${strategyId}/retire`, { reason });
        } catch (error) {
                this.handleError(error);
        }
  }

  async approveStrategy(strategyId: string): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/strategy/:id/approve
          await api.post(`/strategy/${strategyId}/approve`);
        } catch (error) {
                this.handleError(error);
        }
  }

  async rejectStrategy(strategyId: string): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/strategy/:id/reject
          await api.post(`/strategy/${strategyId}/reject`);
        } catch (error) {
                this.handleError(error);
        }
  }

  async pauseStrategy(strategyId: string): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/strategy/:id/pause
          await api.post(`/strategy/${strategyId}/pause`);
        } catch (error) {
                this.handleError(error);
        }
  }

  async resumeStrategy(strategyId: string): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/strategy/:id/resume
          await api.post(`/strategy/${strategyId}/resume`);
        } catch (error) {
                this.handleError(error);
        }
  }

  async getStrategyPerformance(strategyId: string, timeframe: string = '24h'): Promise<any> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/performance (overall performance)
          const response = await api.get('/performance', { params: { timeframe } });
                return response.data;
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  // Agent Settings Methods

  async getAgentSettings(): Promise<AgentSettings> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/settings
          const response = await api.get('/settings');
                return response.data.settings || {
                          runMode: 'manual',
                          autoStartOnLogin: false,
                          continueWhenLoggedOut: false,
                          config: {},
                };
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async saveAgentSettings(settings: AgentSettings): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // POST /api/agent/settings
          await api.post('/settings', settings);
        } catch (error) {
                this.handleError(error);
        }
  }

  // Configuration Methods (maps to /api/agent/settings for config)

  async getConfig(): Promise<{
        riskTolerance: RiskToleranceConfig;
        generationConfig: unknown;
        bankingConfig: BankingConfig;
        optimizationThresholds: unknown;
  }> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/settings - config lives in settings
          const response = await api.get('/settings');
                return response.data.settings?.config || {
                          riskTolerance: { maxDrawdown: 10, riskPerTrade: 2, maxPositionSize: 10, profitBankingPercent: 20 },
                          generationConfig: {},
                          bankingConfig: { enabled: false, bankingPercentage: 20, minimumProfitThreshold: 100, maximumSingleTransfer: 1000, bankingInterval: 24, emergencyStopThreshold: 50, maxDailyBanking: 5000 },
                          optimizationThresholds: {},
                };
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async updateRiskTolerance(riskTolerance: RiskToleranceConfig): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // PUT /api/agent/config - update agent config
          await api.put('/config', { riskTolerance });
        } catch (error) {
                this.handleError(error);
        }
  }

  async updateOptimizationThresholds(thresholds: unknown): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                // PUT /api/agent/config
          await api.put('/config', { optimizationThresholds: thresholds });
        } catch (error) {
                this.handleError(error);
        }
  }

  // Performance Analytics Methods

  async getPerformanceAnalytics(timeframe: string = '24h'): Promise<PerformanceAnalytics> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/performance
          const response = await api.get('/performance', { params: { timeframe } });
                const perf = response.data.performance || {};
                return {
                          totalProfit: perf.totalPnl || 0,
                          totalTrades: perf.totalTrades || 0,
                          winRate: perf.winRate || 0,
                          sharpeRatio: perf.sharpeRatio || 0,
                          maxDrawdown: perf.maxDrawdown || 0,
                          bankedProfits: 0,
                          generationCount: 0,
                          activeStrategies: 0,
                };
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async getGenerationStats(limit: number = 10): Promise<any> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/strategy/recent
          const response = await api.get('/strategy/recent', { params: { limit } });
                return response.data;
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  // Activity Methods

  async getActivity(limit: number = 20): Promise<any[]> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/activity
          const response = await api.get('/activity', { params: { limit } });
                return response.data.activity || [];
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async getLiveActivity(limit: number = 50): Promise<any[]> {
        try {
                const api = createAuthenticatedAxios();
                // GET /api/agent/activity/live
          const response = await api.get('/activity/live', { params: { limit } });
                return response.data.activities || [];
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  // Profit Banking Methods (proxied through agent status - no dedicated banking endpoint yet)

  async getBankingStatus(): Promise<any> {
        try {
                // Banking stats are included in the agent status response
          const status = await this.getSystemStatus();
                return status.bankingStats || {
                          totalBanked: 0,
                          totalTransfers: 0,
                          averageTransferSize: 0,
                          lastBankingTime: null,
                          failedTransfers: 0,
                };
        } catch (error) {
                this.handleError(error);
                throw error;
        }
  }

  async executeBanking(amount: number): Promise<void> {
        // Not yet implemented in backend - log intent
      console.info(`Banking requested for amount: ${amount}`);
  }

  async getBankingHistory(limit: number = 50): Promise<BankingRecord[]> {
        // Not yet implemented in backend - return empty array
      return [];
  }

  async updateBankingConfig(config: BankingConfig): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                await api.put('/config', { bankingConfig: config });
        } catch (error) {
                this.handleError(error);
        }
  }

  async toggleBanking(enabled: boolean): Promise<void> {
        try {
                const api = createAuthenticatedAxios();
                await api.put('/config', { bankingEnabled: enabled });
        } catch (error) {
                this.handleError(error);
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
                if (error.response?.status === 404) {
                          // 404 typically means no active session - not really an error
                  throw new AutonomousTradingAPIError(
                              'No active agent session found',
                              'NO_SESSION',
                              404
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
        const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
        throw new AutonomousTradingAPIError(`Network error: ${message}`);
  }
}

// Export singleton instance
export const autonomousTradingAPI = AutonomousTradingAPIService.getInstance();
export default autonomousTradingAPI;
