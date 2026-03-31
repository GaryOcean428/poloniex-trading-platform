import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { Strategy, StrategyParameters } from '@shared/types/strategy';

/**
 * SDK 0.68.0 does not yet expose `adaptive` thinking or the `output_config`
 * parameter introduced in Claude 4.6.  We extend the params locally so the
 * TypeScript compiler stays happy while remaining fully type-safe for all
 * other fields.
 *
 * Per the Anthropic API docs, `effort` lives inside `output_config`, NOT as
 * a top-level param.
 */
type AdaptiveThinkingConfig = { type: 'adaptive' };
type ExtendedMessageCreateParams = Omit<
  Anthropic.Messages.MessageCreateParamsNonStreaming,
  'thinking'
> & {
  thinking?: AdaptiveThinkingConfig | Anthropic.Messages.ThinkingConfigParam;
  /** output_config.effort controls how much thinking Claude does. */
  output_config?: { effort?: 'low' | 'medium' | 'high' | 'max' };
};

/**
 * LLM-Powered Strategy Generator
 * Uses Claude Sonnet 4.6 to generate novel trading strategies based on market analysis
 */

export interface MarketContext {
  symbol: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  marketCap?: number;
  technicalIndicators: {
    rsi?: number;
    macd?: { line: number; signal: number; histogram: number };
    bollingerBands?: { upper: number; middle: number; lower: number };
    sma20?: number;
    sma50?: number;
    sma200?: number;
    ema12?: number;
    ema26?: number;
    volume?: number;
  };
  marketRegime?: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'calm';
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  recentNews?: string[];
}

export interface GeneratedStrategy {
  name: string;
  description: string;
  type: 'trend_following' | 'mean_reversion' | 'momentum' | 'breakout' | 'scalping' | 'swing' | 'arbitrage';
  algorithm: string;
  parameters: StrategyParameters;
  entryConditions: string[];
  exitConditions: string[];
  riskManagement: {
    stopLossPercent: number;
    takeProfitPercent: number;
    maxPositionSize: number;
    maxDrawdown: number;
  };
  expectedPerformance: {
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
  };
  confidence: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Zod schema for validating / coercing the LLM JSON output
// ---------------------------------------------------------------------------
const GeneratedStrategySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['trend_following', 'mean_reversion', 'momentum', 'breakout', 'scalping', 'swing', 'arbitrage']),
  algorithm: z.string().min(1),
  parameters: z.object({
    pair: z.string().optional(),
    timeframe: z.string().optional(),
    indicators: z.record(z.string(), z.unknown()).optional()
  }).passthrough(),
  entryConditions: z.array(z.string()).min(1),
  exitConditions: z.array(z.string()).min(1),
  riskManagement: z.object({
    stopLossPercent: z.number(),
    takeProfitPercent: z.number(),
    maxPositionSize: z.number(),
    maxDrawdown: z.number()
  }),
  expectedPerformance: z.object({
    winRate: z.number(),
    profitFactor: z.number(),
    sharpeRatio: z.number()
  }).optional().default({ winRate: 0.50, profitFactor: 1.5, sharpeRatio: 1.0 }),
  confidence: z.number().optional().default(70),
  reasoning: z.string().optional().default('LLM-generated strategy')
});

export class LLMStrategyGenerator {
  private client: Anthropic | null = null;
  private model = 'claude-sonnet-4-6';
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    // Don't throw error on missing API key - allow lazy initialization
    if (this.apiKey) {
      this.client = new Anthropic({ apiKey: this.apiKey });
      logger.info('LLM Strategy Generator initialized with Claude Sonnet 4.6 (claude-sonnet-4-6)');
    } else {
      logger.warn('ANTHROPIC_API_KEY not set - LLM strategy generation will be unavailable');
    }
  }

  /**
   * Check if LLM service is available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Ensure client is initialized before use
   */
  private ensureClient(): void {
    if (!this.client) {
      throw new Error('LLM Strategy Generator is not available. Please set ANTHROPIC_API_KEY environment variable.');
    }
  }

  /**
   * Generate a novel trading strategy using LLM
   */
  async generateStrategy(marketContext: MarketContext): Promise<GeneratedStrategy> {
    this.ensureClient();
    try {
      logger.info(`Generating strategy for ${marketContext.symbol} using LLM...`);

      const prompt = this.buildStrategyGenerationPrompt(marketContext);

      // Use adaptive thinking for Sonnet 4.6 with balanced effort and prompt caching
      const response = await (this.client!.messages.create as (params: ExtendedMessageCreateParams) => Promise<Anthropic.Message>)({
        model: this.model,
        max_tokens: 8192,
        temperature: 0.7,
        thinking: {
          type: 'adaptive' as const
        },
        output_config: { effort: 'medium' },
        system: [
          {
            type: 'text',
            text: this.getSystemPrompt(),
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Handle refusal stop reason
      if (response.stop_reason === 'refusal') {
        throw new Error('Claude declined to generate this strategy for safety reasons');
      }

      // Extract text content (skip thinking blocks)
      const textBlocks = response.content.filter(block => block.type === 'text');
      if (textBlocks.length === 0 || textBlocks[0].type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      const strategy = this.parseStrategyResponse(textBlocks[0].text, marketContext);

      logger.info(`Successfully generated strategy: ${strategy.name}`);
      return strategy;
    } catch (error) {
      logger.error('Error generating strategy with LLM:', error);
      throw error;
    }
  }

  /**
   * Generate multiple strategy variations
   */
  async generateStrategyVariations(
    marketContext: MarketContext,
    count: number = 3
  ): Promise<GeneratedStrategy[]> {
    this.ensureClient();
    const strategies: GeneratedStrategy[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const strategy = await this.generateStrategy(marketContext);
        strategies.push(strategy);

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Error generating strategy variation ${i + 1}:`, error);
      }
    }

    return strategies;
  }

  /**
   * Optimize an existing strategy using LLM
   */
  async optimizeStrategy(
    strategy: Strategy,
    performanceData: {
      winRate: number;
      profitFactor: number;
      sharpeRatio: number;
      maxDrawdown: number;
      totalTrades: number;
    },
    marketContext: MarketContext
  ): Promise<GeneratedStrategy> {
    this.ensureClient();
    try {
      logger.info(`Optimizing strategy ${strategy.name} using LLM...`);

      const prompt = this.buildOptimizationPrompt(strategy, performanceData, marketContext);

      // Use adaptive thinking for Sonnet 4.6 with balanced effort and prompt caching
      const response = await (this.client!.messages.create as (params: ExtendedMessageCreateParams) => Promise<Anthropic.Message>)({
        model: this.model,
        max_tokens: 8192,
        temperature: 0.6,
        thinking: {
          type: 'adaptive' as const
        },
        output_config: { effort: 'medium' },
        system: [
          {
            type: 'text',
            text: this.getSystemPrompt(),
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Handle refusal stop reason
      if (response.stop_reason === 'refusal') {
        throw new Error('Claude declined to optimize this strategy for safety reasons');
      }

      // Extract text content (skip thinking blocks)
      const textBlocks = response.content.filter(block => block.type === 'text');
      if (textBlocks.length === 0 || textBlocks[0].type !== 'text') {
        throw new Error('No text content in Claude response');
      }
      const content = textBlocks[0];

      const optimizedStrategy = this.parseStrategyResponse(content.text, marketContext);

      logger.info(`Successfully optimized strategy: ${optimizedStrategy.name}`);
      return optimizedStrategy;
    } catch (error) {
      logger.error('Error optimizing strategy with LLM:', error);
      throw error;
    }
  }

  /**
   * System prompt for strategy generation
   */
  private getSystemPrompt(): string {
    return `You are an expert quantitative trading strategist with deep knowledge of:
- Technical analysis (RSI, MACD, Bollinger Bands, Moving Averages, Volume analysis)
- Market microstructure and order flow
- Risk management and position sizing
- Backtesting and strategy validation
- Cryptocurrency market dynamics

Your task is to generate novel, profitable trading strategies based on current market conditions.

IMPORTANT RULES:
1. Always provide strategies as valid JSON
2. Be specific with entry/exit conditions (use exact indicator values)
3. Include realistic risk management parameters
4. Provide clear reasoning for strategy design
5. Consider market regime when designing strategies
6. Avoid overfitting - strategies should be robust
7. Include expected performance metrics based on similar strategies

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "name": "Strategy Name",
  "description": "Detailed description of the strategy",
  "type": "trend_following|mean_reversion|momentum|breakout|scalping|swing|arbitrage",
  "algorithm": "Specific algorithm name (e.g., 'EMA_Crossover_RSI_Filter')",
  "parameters": {
    "pair": "BTC-USDT",
    "timeframe": "1h|4h|1d",
    "indicators": {
      "ema_fast": 12,
      "ema_slow": 26,
      "rsi_period": 14,
      "rsi_overbought": 70,
      "rsi_oversold": 30
    }
  },
  "entryConditions": [
    "EMA(12) crosses above EMA(26)",
    "RSI < 70 (not overbought)",
    "Volume > 1.5x average"
  ],
  "exitConditions": [
    "EMA(12) crosses below EMA(26)",
    "RSI > 70 (overbought)",
    "Stop loss hit (-2%)",
    "Take profit hit (+5%)"
  ],
  "riskManagement": {
    "stopLossPercent": 2.0,
    "takeProfitPercent": 5.0,
    "maxPositionSize": 0.1,
    "maxDrawdown": 0.15
  },
  "expectedPerformance": {
    "winRate": 0.55,
    "profitFactor": 1.8,
    "sharpeRatio": 1.2
  },
  "confidence": 75,
  "reasoning": "Explanation of why this strategy should work in current market conditions"
}`;
  }

  /**
   * Safe number formatting helper — returns 'N/A' for undefined/null/NaN values
   */
  private safeFixed(value: number | undefined | null, decimals: number = 2): string {
    if (value == null || isNaN(value)) return 'N/A';
    return value.toFixed(decimals);
  }

  /**
   * Build prompt for strategy generation.
   * Handles incomplete MarketContext gracefully — the enhanced agent may pass
   * partial context (e.g. symbol + strategyType only) when real market data
   * is unavailable. Missing fields render as 'N/A' rather than crashing.
   */
  private buildStrategyGenerationPrompt(context: MarketContext): string {
    const { symbol, currentPrice, priceChange24h, volume24h, technicalIndicators, marketRegime, sentiment } = context;
    const ti = technicalIndicators || {};

    return `Generate a novel trading strategy for ${symbol} based on the following market analysis:

CURRENT MARKET CONDITIONS:
- Symbol: ${symbol}
- Current Price: $${this.safeFixed(currentPrice)}
- 24h Price Change: ${this.safeFixed(priceChange24h)}%
- 24h Volume: ${volume24h != null ? volume24h.toLocaleString() : 'N/A'}
- Market Regime: ${marketRegime || 'unknown'}
- Sentiment: ${sentiment || 'neutral'}

TECHNICAL INDICATORS:
${ti.rsi != null ? `- RSI: ${this.safeFixed(ti.rsi)}` : ''}
${ti.macd ? `- MACD: Line=${this.safeFixed(ti.macd.line)}, Signal=${this.safeFixed(ti.macd.signal)}, Histogram=${this.safeFixed(ti.macd.histogram)}` : ''}
${ti.bollingerBands ? `- Bollinger Bands: Upper=${this.safeFixed(ti.bollingerBands.upper)}, Middle=${this.safeFixed(ti.bollingerBands.middle)}, Lower=${this.safeFixed(ti.bollingerBands.lower)}` : ''}
${ti.sma20 != null ? `- SMA(20): ${this.safeFixed(ti.sma20)}` : ''}
${ti.sma50 != null ? `- SMA(50): ${this.safeFixed(ti.sma50)}` : ''}
${ti.sma200 != null ? `- SMA(200): ${this.safeFixed(ti.sma200)}` : ''}

REQUIREMENTS:
1. Design a strategy that exploits the current market regime
2. Use appropriate technical indicators for this market condition
3. Include clear, specific entry and exit rules
4. Provide realistic risk management parameters
5. Estimate expected performance based on similar strategies
6. Explain your reasoning

Generate a profitable trading strategy as JSON (follow the exact format specified in your system prompt).`;
  }

  /**
   * Build prompt for strategy optimization
   */
  private buildOptimizationPrompt(
    strategy: Strategy,
    performance: {
      winRate: number;
      profitFactor: number;
      sharpeRatio: number;
      maxDrawdown: number;
      totalTrades: number;
    },
    context: MarketContext
  ): string {
    return `Optimize the following trading strategy based on its performance data:

CURRENT STRATEGY:
- Name: ${strategy.name}
- Type: ${strategy.type}
- Algorithm: ${strategy.algorithm}
- Parameters: ${JSON.stringify(strategy.parameters, null, 2)}

PERFORMANCE DATA:
- Win Rate: ${this.safeFixed(performance.winRate * 100)}%
- Profit Factor: ${this.safeFixed(performance.profitFactor)}
- Sharpe Ratio: ${this.safeFixed(performance.sharpeRatio)}
- Max Drawdown: ${this.safeFixed(performance.maxDrawdown * 100)}%
- Total Trades: ${performance.totalTrades}

CURRENT MARKET CONDITIONS:
- Symbol: ${context.symbol}
- Current Price: $${this.safeFixed(context.currentPrice)}
- 24h Change: ${this.safeFixed(context.priceChange24h)}%
- Market Regime: ${context.marketRegime || 'unknown'}

OPTIMIZATION GOALS:
1. Improve win rate (target: >55%)
2. Increase Sharpe ratio (target: >1.5)
3. Reduce max drawdown (target: <15%)
4. Maintain or improve profit factor

ANALYSIS:
- If win rate is low, tighten entry conditions or add filters
- If drawdown is high, improve stop loss placement
- If Sharpe ratio is low, optimize risk/reward ratio
- If profit factor is low, improve exit timing

Generate an optimized version of this strategy as JSON (follow the exact format specified in your system prompt).`;
  }

  /**
   * Parse LLM response into structured strategy using Zod schema validation
   */
  private parseStrategyResponse(response: string, context: MarketContext): GeneratedStrategy {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed: unknown = JSON.parse(jsonStr);

      // Validate and coerce via Zod schema; defaults for optional fields are applied here
      const result = GeneratedStrategySchema.parse(parsed);

      // Ensure parameters include pair and timeframe
      if (!result.parameters.pair) {
        result.parameters.pair = context.symbol;
      }
      if (!result.parameters.timeframe) {
        result.parameters.timeframe = '1h';
      }

      return result as GeneratedStrategy;
    } catch (error) {
      logger.error('Error parsing LLM strategy response:', error);
      logger.error('Response was:', response);
      throw new Error(`Failed to parse LLM response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Singleton instance - lazy loaded
let llmStrategyGeneratorInstance: LLMStrategyGenerator | null = null;

/**
 * Get or create the LLM strategy generator singleton
 */
export function getLLMStrategyGenerator(): LLMStrategyGenerator {
  if (!llmStrategyGeneratorInstance) {
    llmStrategyGeneratorInstance = new LLMStrategyGenerator();
  }
  return llmStrategyGeneratorInstance;
}
