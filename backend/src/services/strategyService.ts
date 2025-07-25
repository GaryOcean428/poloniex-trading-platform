// TypeScript service demonstrating usage of shared Strategy types
// This shows how the backend would use shared types if converted to TypeScript

import { 
  Strategy, 
  StrategyParameters, 
  StrategyPerformance,
  MovingAverageCrossoverParameters,
  RSIParameters,
  BreakoutParameters,
  MACDParameters,
  BollingerBandsParameters
} from '@shared/types/strategy';

export interface StrategyServiceInterface {
  getAllStrategies(): Promise<Strategy[]>;
  getStrategyById(id: string): Promise<Strategy | null>;
  createStrategy(strategyData: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>): Promise<Strategy>;
  updateStrategy(id: string, updates: Partial<Strategy>): Promise<Strategy | null>;
  deleteStrategy(id: string): Promise<boolean>;
  updateStrategyPerformance(id: string, performance: StrategyPerformance): Promise<Strategy | null>;
}

export class StrategyService implements StrategyServiceInterface {
  private strategies: Strategy[] = [];

  constructor() {
    // Initialize with some mock data
    this.initializeMockData();
  }

  private initializeMockData(): void {
    this.strategies = [
      {
        id: '1',
        name: 'MA Crossover BTC-USDT',
        type: 'automated',
        algorithm: 'MovingAverageCrossover',
        active: true,
        parameters: {
          pair: 'BTC-USDT',
          timeframe: '1h',
          fastPeriod: 10,
          slowPeriod: 50
        },
        performance: {
          totalPnL: 1250.75,
          winRate: 0.65,
          tradesCount: 47,
          sharpeRatio: 1.23
        },
        createdAt: new Date('2024-01-15').toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'RSI ETH Strategy',
        type: 'automated',
        algorithm: 'RSI',
        active: false,
        parameters: {
          pair: 'ETH-USDT',
          timeframe: '4h',
          period: 14,
          overbought: 70,
          oversold: 30
        },
        performance: {
          totalPnL: -200.25,
          winRate: 0.42,
          tradesCount: 23,
          sharpeRatio: -0.15
        },
        createdAt: new Date('2024-01-20').toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  async getAllStrategies(): Promise<Strategy[]> {
    // In a real implementation, this would query a database
    return Promise.resolve([...this.strategies]);
  }

  async getStrategyById(id: string): Promise<Strategy | null> {
    const strategy = this.strategies.find(s => s.id === id);
    return Promise.resolve(strategy || null);
  }

  async createStrategy(strategyData: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>): Promise<Strategy> {
    const newStrategy: Strategy = {
      ...strategyData,
      id: (this.strategies.length + 1).toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.strategies.push(newStrategy);
    return Promise.resolve(newStrategy);
  }

  async updateStrategy(id: string, updates: Partial<Strategy>): Promise<Strategy | null> {
    const strategyIndex = this.strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      return Promise.resolve(null);
    }

    const updatedStrategy: Strategy = {
      ...this.strategies[strategyIndex],
      ...updates,
      id, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString()
    };

    this.strategies[strategyIndex] = updatedStrategy;
    return Promise.resolve(updatedStrategy);
  }

  async deleteStrategy(id: string): Promise<boolean> {
    const strategyIndex = this.strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      return Promise.resolve(false);
    }

    this.strategies.splice(strategyIndex, 1);
    return Promise.resolve(true);
  }

  async updateStrategyPerformance(id: string, performance: StrategyPerformance): Promise<Strategy | null> {
    const strategyIndex = this.strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      return Promise.resolve(null);
    }

    this.strategies[strategyIndex].performance = performance;
    this.strategies[strategyIndex].updatedAt = new Date().toISOString();

    return Promise.resolve(this.strategies[strategyIndex]);
  }

  // Additional helper methods that leverage the unified Strategy interface

  async getActiveStrategies(): Promise<Strategy[]> {
    const allStrategies = await this.getAllStrategies();
    return allStrategies.filter(strategy => strategy.active);
  }

  async getStrategiesByType(type: Strategy['type']): Promise<Strategy[]> {
    const allStrategies = await this.getAllStrategies();
    return allStrategies.filter(strategy => strategy.type === type);
  }

  async getStrategiesByAlgorithm(algorithm: Strategy['algorithm']): Promise<Strategy[]> {
    const allStrategies = await this.getAllStrategies();
    return allStrategies.filter(strategy => strategy.algorithm === algorithm);
  }

  async activateStrategy(id: string): Promise<Strategy | null> {
    return this.updateStrategy(id, { active: true });
  }

  async deactivateStrategy(id: string): Promise<Strategy | null> {
    return this.updateStrategy(id, { active: false });
  }

  // Validation methods that ensure data conforms to the unified interface

  validateStrategyParameters(algorithm: string, parameters: StrategyParameters): boolean {
    // First check base parameters
    if (!parameters.pair || !parameters.timeframe) {
      return false;
    }

    switch (algorithm) {
      case 'MovingAverageCrossover':
        return this.isMovingAverageCrossoverParameters(parameters);
      
      case 'RSI':
        return this.isRSIParameters(parameters);
      
      case 'Breakout':
        return this.isBreakoutParameters(parameters);
      
      case 'MACD':
        return this.isMACDParameters(parameters);
      
      case 'BollingerBands':
        return this.isBollingerBandsParameters(parameters);
      
      default:
        return true; // Base parameters are already validated
    }
  }

  private isMovingAverageCrossoverParameters(params: StrategyParameters): params is MovingAverageCrossoverParameters {
    const maParams = params as MovingAverageCrossoverParameters;
    return !!(
      (maParams.fastPeriod || maParams.shortPeriod) &&
      (maParams.slowPeriod || maParams.longPeriod)
    );
  }

  private isRSIParameters(params: StrategyParameters): params is RSIParameters {
    const rsiParams = params as RSIParameters;
    return !!(
      typeof rsiParams.period === 'number' &&
      typeof rsiParams.overbought === 'number' &&
      typeof rsiParams.oversold === 'number'
    );
  }

  private isBreakoutParameters(params: StrategyParameters): params is BreakoutParameters {
    const breakoutParams = params as BreakoutParameters;
    return !!(
      typeof breakoutParams.lookbackPeriod === 'number' &&
      typeof breakoutParams.breakoutThreshold === 'number'
    );
  }

  private isMACDParameters(params: StrategyParameters): params is MACDParameters {
    const macdParams = params as MACDParameters;
    return !!(
      typeof macdParams.fastPeriod === 'number' &&
      typeof macdParams.slowPeriod === 'number' &&
      typeof macdParams.signalPeriod === 'number'
    );
  }

  private isBollingerBandsParameters(params: StrategyParameters): params is BollingerBandsParameters {
    const bbParams = params as BollingerBandsParameters;
    return !!(
      typeof bbParams.period === 'number' &&
      typeof bbParams.stdDev === 'number'
    );
  }

  async validateAndCreateStrategy(strategyData: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>): Promise<Strategy> {
    // Validate the strategy data against the unified interface
    if (!this.validateStrategyParameters(strategyData.algorithm || 'Custom', strategyData.parameters)) {
      throw new Error('Invalid strategy parameters for the specified algorithm');
    }

    return this.createStrategy(strategyData);
  }
}

export default StrategyService;
