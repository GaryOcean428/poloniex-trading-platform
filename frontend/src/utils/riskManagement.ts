import { MarketData } from '@/types';
import { calculateATR } from './technicalIndicators';

/**
 * Advanced Risk Management System for Autonomous Trading
 * Implements comprehensive risk controls and position sizing
 */

export interface RiskParameters {
  // Account-level risk settings
  maxAccountRisk: number; // Maximum percentage of account at risk (default: 2%)
  maxDailyLoss: number; // Maximum daily loss percentage (default: 5%)
  maxDrawdown: number; // Maximum drawdown percentage (default: 10%)
  
  // Position-level risk settings
  maxPositionSize: number; // Maximum position size percentage (default: 5%)
  maxLeverage: number; // Maximum leverage allowed (default: 3x)
  maxPositionsPerPair: number; // Maximum positions per trading pair (default: 1)
  maxTotalPositions: number; // Maximum total open positions (default: 5)
  
  // Stop loss and take profit settings
  useATRStops: boolean; // Use ATR-based stops (default: true)
  atrMultiplier: number; // ATR multiplier for stops (default: 2)
  stopLossPercent: number; // Fixed stop loss percentage (default: 2%)
  takeProfitRatio: number; // Take profit to stop loss ratio (default: 2:1)
  useTrailingStops: boolean; // Enable trailing stops (default: true)
  trailingStopPercent: number; // Trailing stop percentage (default: 1%)
  
  // Risk-adjusted sizing
  useVolatilityAdjustment: boolean; // Adjust position size based on volatility (default: true)
  baseVolatility: number; // Base volatility for sizing (default: 1%)
  correlationThreshold: number; // Maximum correlation between positions (default: 0.7)
}

export interface PositionRisk {
  pair: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  leverage: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  riskAmount: number;
  riskPercent: number;
}

export interface PortfolioRisk {
  totalValue: number;
  totalRisk: number;
  totalRiskPercent: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  maxDrawdown: number;
  currentDrawdown: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  positionCount: number;
  leverageUtilization: number;
  correlationRisk: number;
}

export interface RiskAssessment {
  canOpenPosition: boolean;
  recommendedSize: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskReward: number;
  reasons: string[];
  warnings: string[];
}

export class RiskManager {
  private parameters: RiskParameters;
  private positions: Map<string, PositionRisk> = new Map();
  private dailyStartValue: number = 0;
  private maxPortfolioValue: number = 0;
  private correlationMatrix: Map<string, Map<string, number>> = new Map();

  constructor(parameters?: Partial<RiskParameters>) {
    this.parameters = {
      // Account-level defaults
      maxAccountRisk: 2,
      maxDailyLoss: 5,
      maxDrawdown: 10,
      
      // Position-level defaults
      maxPositionSize: 5,
      maxLeverage: 3,
      maxPositionsPerPair: 1,
      maxTotalPositions: 5,
      
      // Stop loss defaults
      useATRStops: true,
      atrMultiplier: 2,
      stopLossPercent: 2,
      takeProfitRatio: 2,
      useTrailingStops: true,
      trailingStopPercent: 1,
      
      // Risk adjustment defaults
      useVolatilityAdjustment: true,
      baseVolatility: 1,
      correlationThreshold: 0.7,
      
      ...parameters
    };
  }

  /**
   * Update risk parameters
   */
  updateParameters(newParameters: Partial<RiskParameters>): void {
    this.parameters = { ...this.parameters, ...newParameters };
  }

  /**
   * Calculate optimal position size based on risk parameters
   */
  calculatePositionSize(
    accountBalance: number,
    entryPrice: number,
    stopLossPrice: number,
    marketData?: MarketData[],
    pair?: string
  ): number {
    const riskAmount = accountBalance * (this.parameters.maxAccountRisk / 100);
    const priceRisk = Math.abs(entryPrice - stopLossPrice);
    
    if (priceRisk === 0) {
      throw new Error('Stop loss price cannot equal entry price');
    }
    
    let baseSize = riskAmount / priceRisk;
    
    // Apply maximum position size limit
    const maxSizeByPercent = (accountBalance * this.parameters.maxPositionSize / 100) / entryPrice;
    baseSize = Math.min(baseSize, maxSizeByPercent);
    
    // Apply volatility adjustment if enabled
    if (this.parameters.useVolatilityAdjustment && marketData) {
      const volatilityAdjustment = this.calculateVolatilityAdjustment(marketData);
      baseSize *= volatilityAdjustment;
    }
    
    // Apply correlation adjustment if enabled
    if (pair && this.parameters.correlationThreshold < 1) {
      const correlationAdjustment = this.calculateCorrelationAdjustment(pair);
      baseSize *= correlationAdjustment;
    }
    
    return Math.max(baseSize, 0);
  }

  /**
   * Calculate ATR-based stop loss and take profit levels
   */
  calculateATRLevels(
    marketData: MarketData[],
    entryPrice: number,
    direction: 'long' | 'short',
    atrPeriod: number = 14
  ): { stopLoss: number; takeProfit: number } {
    if (!this.parameters.useATRStops) {
      const stopLossDistance = entryPrice * (this.parameters.stopLossPercent / 100);
      const stopLoss = direction === 'long' 
        ? entryPrice - stopLossDistance 
        : entryPrice + stopLossDistance;
      
      const takeProfitDistance = stopLossDistance * this.parameters.takeProfitRatio;
      const takeProfit = direction === 'long' 
        ? entryPrice + takeProfitDistance 
        : entryPrice - takeProfitDistance;
      
      return { stopLoss, takeProfit };
    }
    
    const atr = calculateATR(marketData, atrPeriod);
    const atrValue = atr.currentValue;
    const atrDistance = atrValue * this.parameters.atrMultiplier;
    
    const stopLoss = direction === 'long' 
      ? entryPrice - atrDistance 
      : entryPrice + atrDistance;
    
    const takeProfitDistance = atrDistance * this.parameters.takeProfitRatio;
    const takeProfit = direction === 'long' 
      ? entryPrice + takeProfitDistance 
      : entryPrice - takeProfitDistance;
    
    return { stopLoss, takeProfit };
  }

  /**
   * Assess risk for a new position
   */
  assessPositionRisk(
    pair: string,
    entryPrice: number,
    size: number,
    direction: 'long' | 'short',
    accountBalance: number,
    leverage: number = 1,
    marketData?: MarketData[]
  ): RiskAssessment {
    const assessment: RiskAssessment = {
      canOpenPosition: true,
      recommendedSize: size,
      stopLossPrice: 0,
      takeProfitPrice: 0,
      riskReward: 0,
      reasons: [],
      warnings: []
    };

    // Check maximum leverage
    if (leverage > this.parameters.maxLeverage) {
      assessment.canOpenPosition = false;
      assessment.reasons.push(`Leverage ${leverage}x exceeds maximum ${this.parameters.maxLeverage}x`);
    }

    // Check maximum positions per pair
    const existingPositions = Array.from(this.positions.values()).filter(p => p.pair === pair);
    if (existingPositions.length >= this.parameters.maxPositionsPerPair) {
      assessment.canOpenPosition = false;
      assessment.reasons.push(`Maximum positions per pair (${this.parameters.maxPositionsPerPair}) reached for ${pair}`);
    }

    // Check total positions limit
    if (this.positions.size >= this.parameters.maxTotalPositions) {
      assessment.canOpenPosition = false;
      assessment.reasons.push(`Maximum total positions (${this.parameters.maxTotalPositions}) reached`);
    }

    // Calculate stop loss and take profit
    let stopLoss: number, takeProfit: number;
    
    if (marketData && this.parameters.useATRStops) {
      const levels = this.calculateATRLevels(marketData, entryPrice, direction);
      stopLoss = levels.stopLoss;
      takeProfit = levels.takeProfit;
    } else {
      const stopDistance = entryPrice * (this.parameters.stopLossPercent / 100);
      stopLoss = direction === 'long' ? entryPrice - stopDistance : entryPrice + stopDistance;
      takeProfit = direction === 'long' 
        ? entryPrice + (stopDistance * this.parameters.takeProfitRatio)
        : entryPrice - (stopDistance * this.parameters.takeProfitRatio);
    }

    assessment.stopLossPrice = stopLoss;
    assessment.takeProfitPrice = takeProfit;

    // Calculate risk-reward ratio
    const riskDistance = Math.abs(entryPrice - stopLoss);
    const rewardDistance = Math.abs(takeProfit - entryPrice);
    assessment.riskReward = rewardDistance / riskDistance;

    // Check minimum risk-reward ratio
    if (assessment.riskReward < 1.5) {
      assessment.warnings.push(`Low risk-reward ratio: ${assessment.riskReward.toFixed(2)}`);
    }

    // Calculate optimal position size
    const optimalSize = this.calculatePositionSize(
      accountBalance, 
      entryPrice, 
      stopLoss, 
      marketData, 
      pair
    );
    
    if (size > optimalSize * 1.5) {
      assessment.warnings.push(`Position size ${size.toFixed(6)} exceeds recommended ${optimalSize.toFixed(6)}`);
      assessment.recommendedSize = optimalSize;
    }

    // Check portfolio heat
    const portfolioRisk = this.calculatePortfolioRisk(accountBalance);
    const newPositionRisk = (size * Math.abs(entryPrice - stopLoss)) / accountBalance * 100;
    
    if (portfolioRisk.totalRiskPercent + newPositionRisk > this.parameters.maxAccountRisk * 2) {
      assessment.canOpenPosition = false;
      assessment.reasons.push(`Total portfolio risk would exceed ${this.parameters.maxAccountRisk * 2}%`);
    }

    // Check daily loss limit
    if (portfolioRisk.dailyPnLPercent < -this.parameters.maxDailyLoss) {
      assessment.canOpenPosition = false;
      assessment.reasons.push(`Daily loss limit (${this.parameters.maxDailyLoss}%) reached`);
    }

    // Check maximum drawdown
    if (portfolioRisk.currentDrawdown > this.parameters.maxDrawdown) {
      assessment.canOpenPosition = false;
      assessment.reasons.push(`Maximum drawdown (${this.parameters.maxDrawdown}%) exceeded`);
    }

    return assessment;
  }

  /**
   * Add a new position to risk tracking
   */
  addPosition(
    pair: string,
    entryPrice: number,
    quantity: number,
    leverage: number = 1,
    stopLoss?: number,
    takeProfit?: number
  ): void {
    const positionRisk: PositionRisk = {
      pair,
      entryPrice,
      currentPrice: entryPrice,
      quantity,
      leverage,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit,
      riskAmount: stopLoss ? Math.abs((entryPrice - stopLoss) * quantity) : 0,
      riskPercent: 0
    };

    this.positions.set(`${pair}-${Date.now()}`, positionRisk);
  }

  /**
   * Update position with current market price
   */
  updatePosition(positionId: string, currentPrice: number): void {
    const position = this.positions.get(positionId);
    if (!position) return;

    position.currentPrice = currentPrice;
    position.unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity * position.leverage;
    position.unrealizedPnLPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * position.leverage;

    // Update trailing stop if enabled
    if (this.parameters.useTrailingStops && position.stopLossPrice) {
      const isLong = position.quantity > 0;
      const trailingDistance = currentPrice * (this.parameters.trailingStopPercent / 100);
      
      if (isLong && currentPrice > position.entryPrice) {
        const newStopLoss = currentPrice - trailingDistance;
        if (newStopLoss > position.stopLossPrice) {
          position.stopLossPrice = newStopLoss;
        }
      } else if (!isLong && currentPrice < position.entryPrice) {
        const newStopLoss = currentPrice + trailingDistance;
        if (newStopLoss < position.stopLossPrice!) {
          position.stopLossPrice = newStopLoss;
        }
      }
    }
  }

  /**
   * Remove a position from tracking
   */
  removePosition(positionId: string): void {
    this.positions.delete(positionId);
  }

  /**
   * Calculate overall portfolio risk metrics
   */
  calculatePortfolioRisk(accountBalance: number): PortfolioRisk {
    const positions = Array.from(this.positions.values());
    
    const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
    const totalRisk = positions.reduce((sum, pos) => sum + pos.riskAmount, 0);
    
    const currentValue = accountBalance + totalUnrealizedPnL;
    const currentDrawdown = Math.max(0, ((this.maxPortfolioValue - currentValue) / this.maxPortfolioValue) * 100);
    
    // Update maximum portfolio value
    if (currentValue > this.maxPortfolioValue) {
      this.maxPortfolioValue = currentValue;
    }
    
    // Calculate daily P&L
    const dailyPnL = this.dailyStartValue > 0 ? currentValue - this.dailyStartValue : 0;
    const dailyPnLPercent = this.dailyStartValue > 0 ? (dailyPnL / this.dailyStartValue) * 100 : 0;
    
    // Calculate leverage utilization
    const totalPositionValue = positions.reduce((sum, pos) => 
      sum + (Math.abs(pos.quantity) * pos.currentPrice * pos.leverage), 0
    );
    const leverageUtilization = (totalPositionValue / accountBalance) || 0;
    
    return {
      totalValue: currentValue,
      totalRisk,
      totalRiskPercent: (totalRisk / accountBalance) * 100,
      unrealizedPnL: totalUnrealizedPnL,
      unrealizedPnLPercent: (totalUnrealizedPnL / accountBalance) * 100,
      maxDrawdown: this.maxPortfolioValue > 0 ? ((this.maxPortfolioValue - accountBalance) / this.maxPortfolioValue) * 100 : 0,
      currentDrawdown,
      dailyPnL,
      dailyPnLPercent,
      positionCount: positions.length,
      leverageUtilization,
      correlationRisk: this.calculatePortfolioCorrelationRisk()
    };
  }

  /**
   * Check if emergency stop conditions are met
   */
  checkEmergencyStop(accountBalance: number): { shouldStop: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const portfolioRisk = this.calculatePortfolioRisk(accountBalance);
    
    // Check daily loss limit
    if (portfolioRisk.dailyPnLPercent < -this.parameters.maxDailyLoss) {
      reasons.push(`Daily loss limit exceeded: ${portfolioRisk.dailyPnLPercent.toFixed(2)}%`);
    }
    
    // Check maximum drawdown
    if (portfolioRisk.currentDrawdown > this.parameters.maxDrawdown) {
      reasons.push(`Maximum drawdown exceeded: ${portfolioRisk.currentDrawdown.toFixed(2)}%`);
    }
    
    // Check if account risk is too high
    if (portfolioRisk.totalRiskPercent > this.parameters.maxAccountRisk * 3) {
      reasons.push(`Total account risk too high: ${portfolioRisk.totalRiskPercent.toFixed(2)}%`);
    }
    
    return {
      shouldStop: reasons.length > 0,
      reasons
    };
  }

  /**
   * Set daily starting value for P&L calculation
   */
  setDailyStartValue(value: number): void {
    this.dailyStartValue = value;
  }

  /**
   * Get all current positions
   */
  getPositions(): PositionRisk[] {
    return Array.from(this.positions.values());
  }

  /**
   * Calculate volatility adjustment factor
   */
  private calculateVolatilityAdjustment(marketData: MarketData[]): number {
    if (marketData.length < 20) return 1;
    
    // Calculate recent volatility (20-period)
    const returns = [];
    for (let i = 1; i < Math.min(marketData.length, 21); i++) {
      const return_ = (marketData[i].close - marketData[i - 1].close) / marketData[i - 1].close;
      returns.push(return_);
    }
    
    const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * 100; // Convert to percentage
    
    // Adjust position size inverse to volatility
    const adjustment = this.parameters.baseVolatility / Math.max(volatility, 0.1);
    return Math.min(Math.max(adjustment, 0.2), 2); // Limit adjustment between 0.2x and 2x
  }

  /**
   * Calculate correlation adjustment factor
   */
  private calculateCorrelationAdjustment(newPair: string): number {
    const correlations = this.correlationMatrix.get(newPair);
    if (!correlations) return 1;
    
    const existingPairs = Array.from(this.positions.values()).map(p => p.pair);
    const maxCorrelation = Math.max(0, ...existingPairs.map(pair => correlations.get(pair) || 0));
    
    if (maxCorrelation > this.parameters.correlationThreshold) {
      return 1 - (maxCorrelation - this.parameters.correlationThreshold);
    }
    
    return 1;
  }

  /**
   * Calculate portfolio correlation risk
   */
  private calculatePortfolioCorrelationRisk(): number {
    const pairs = Array.from(this.positions.values()).map(p => p.pair);
    if (pairs.length < 2) return 0;
    
    let totalCorrelation = 0;
    let count = 0;
    
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const correlation = this.correlationMatrix.get(pairs[i])?.get(pairs[j]) || 0;
        totalCorrelation += Math.abs(correlation);
        count++;
      }
    }
    
    return count > 0 ? totalCorrelation / count : 0;
  }

  /**
   * Update correlation matrix (should be called periodically with market data)
   */
  updateCorrelationMatrix(correlations: Map<string, Map<string, number>>): void {
    this.correlationMatrix = correlations;
  }
}

/**
 * Create a default risk manager instance
 */
export function createRiskManager(parameters?: Partial<RiskParameters>): RiskManager {
  return new RiskManager(parameters);
}

/**
 * Calculate correlation between two price series
 */
export function calculateCorrelation(series1: number[], series2: number[]): number {
  if (series1.length !== series2.length || series1.length < 2) {
    return 0;
  }
  
  const n = series1.length;
  const mean1 = series1.reduce((sum, val) => sum + val, 0) / n;
  const mean2 = series2.reduce((sum, val) => sum + val, 0) / n;
  
  let numerator = 0;
  let sumSq1 = 0;
  let sumSq2 = 0;
  
  for (let i = 0; i < n; i++) {
    const diff1 = series1[i] - mean1;
    const diff2 = series2[i] - mean2;
    numerator += diff1 * diff2;
    sumSq1 += diff1 * diff1;
    sumSq2 += diff2 * diff2;
  }
  
  const denominator = Math.sqrt(sumSq1 * sumSq2);
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Default risk parameters for different risk profiles
 */
export const RISK_PROFILES = {
  conservative: {
    maxAccountRisk: 1,
    maxDailyLoss: 2,
    maxDrawdown: 5,
    maxPositionSize: 2,
    maxLeverage: 1,
    stopLossPercent: 1,
    takeProfitRatio: 3
  },
  moderate: {
    maxAccountRisk: 2,
    maxDailyLoss: 5,
    maxDrawdown: 10,
    maxPositionSize: 5,
    maxLeverage: 3,
    stopLossPercent: 2,
    takeProfitRatio: 2
  },
  aggressive: {
    maxAccountRisk: 5,
    maxDailyLoss: 10,
    maxDrawdown: 20,
    maxPositionSize: 10,
    maxLeverage: 5,
    stopLossPercent: 3,
    takeProfitRatio: 1.5
  }
} as const;