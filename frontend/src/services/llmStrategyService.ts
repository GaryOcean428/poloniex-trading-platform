/**
 * LLM Strategy Service
 * Frontend service for AI-powered strategy generation using Claude
 */

import { apiClient } from './api';

export interface StrategyGenerationRequest {
  marketConditions?: {
    trend?: string;
    volatility?: string;
    volume?: string;
  };
  riskTolerance?: 'low' | 'medium' | 'high';
  tradingPair?: string;
  timeframe?: string;
  constraints?: {
    maxPositionSize?: number;
    maxLeverage?: number;
    stopLossRequired?: boolean;
  };
}

export interface StrategyVariationsRequest extends StrategyGenerationRequest {
  count: number; // 1-5
}

export interface StrategyOptimizationRequest {
  strategyCode: string;
  performanceData: {
    totalTrades: number;
    winRate: number;
    profitLoss: number;
    maxDrawdown: number;
    sharpeRatio?: number;
  };
  issues?: string[];
}

export interface GeneratedStrategy {
  name: string;
  description: string;
  code: string;
  parameters: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high';
  expectedWinRate?: number;
  recommendedTimeframe?: string;
  reasoning: string;
}

export interface MarketAnalysis {
  trend: string;
  volatility: string;
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  recommendations: string[];
  suggestedStrategies: string[];
}

/**
 * Generate a single AI-powered trading strategy
 */
export async function generateStrategy(
  request: StrategyGenerationRequest
): Promise<GeneratedStrategy> {
  try {
    const response = await apiClient.post<{ strategy: GeneratedStrategy }>('/llm-strategies/generate', request);
    return response.data.strategy;
  } catch (error: any) {
    if (error.response?.status === 503) {
      throw new Error('LLM strategy generation is not available. Please add ANTHROPIC_API_KEY to enable this feature.');
    }
    throw new Error(error.response?.data?.error || 'Failed to generate strategy');
  }
}

/**
 * Generate multiple strategy variations
 */
export async function generateStrategyVariations(
  request: StrategyVariationsRequest
): Promise<GeneratedStrategy[]> {
  try {
    const response = await apiClient.post<{ strategies: GeneratedStrategy[] }>('/llm-strategies/generate-variations', request);
    return response.data.strategies;
  } catch (error: any) {
    if (error.response?.status === 503) {
      throw new Error('LLM strategy generation is not available. Please add ANTHROPIC_API_KEY to enable this feature.');
    }
    throw new Error(error.response?.data?.error || 'Failed to generate strategy variations');
  }
}

/**
 * Optimize an existing strategy based on performance data
 */
export async function optimizeStrategy(
  request: StrategyOptimizationRequest
): Promise<GeneratedStrategy> {
  try {
    const response = await apiClient.post<{ optimizedStrategy: GeneratedStrategy }>('/llm-strategies/optimize', request);
    return response.data.optimizedStrategy;
  } catch (error: any) {
    if (error.response?.status === 503) {
      throw new Error('LLM strategy optimization is not available. Please add ANTHROPIC_API_KEY to enable this feature.');
    }
    throw new Error(error.response?.data?.error || 'Failed to optimize strategy');
  }
}

/**
 * Analyze market conditions and get AI recommendations
 */
export async function analyzeMarket(
  tradingPair: string,
  timeframe: string = '1h'
): Promise<MarketAnalysis> {
  try {
    const response = await apiClient.post<{ analysis: MarketAnalysis }>('/llm-strategies/analyze-market', {
      tradingPair,
      timeframe
    });
    return response.data.analysis;
  } catch (error: any) {
    if (error.response?.status === 503) {
      throw new Error('LLM market analysis is not available. Please add ANTHROPIC_API_KEY to enable this feature.');
    }
    throw new Error(error.response?.data?.error || 'Failed to analyze market');
  }
}

/**
 * Check if LLM features are available
 */
export async function checkLLMAvailability(): Promise<boolean> {
  try {
    const response = await apiClient.get<{ available: boolean }>('/llm-strategies/status');
    return response.data.available === true;
  } catch (_error) {
    return false;
  }
}
