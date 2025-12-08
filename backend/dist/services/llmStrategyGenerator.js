import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
export class LLMStrategyGenerator {
    constructor() {
        this.client = null;
        this.model = 'claude-3-5-sonnet-20241022'; // Claude 3.5 Sonnet (latest stable)
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        // Don't throw error on missing API key - allow lazy initialization
        if (this.apiKey) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            logger.info('LLM Strategy Generator initialized with Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)');
        }
        else {
            logger.warn('ANTHROPIC_API_KEY not set - LLM strategy generation will be unavailable');
        }
    }
    /**
     * Check if LLM service is available
     */
    isAvailable() {
        return this.client !== null;
    }
    /**
     * Ensure client is initialized before use
     */
    ensureClient() {
        if (!this.client) {
            throw new Error('LLM Strategy Generator is not available. Please set ANTHROPIC_API_KEY environment variable.');
        }
    }
    /**
     * Generate a novel trading strategy using LLM
     */
    async generateStrategy(marketContext) {
        this.ensureClient();
        try {
            logger.info(`Generating strategy for ${marketContext.symbol} using LLM...`);
            const prompt = this.buildStrategyGenerationPrompt(marketContext);
            // Use extended thinking for complex strategy generation
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 8192, // Increased for detailed strategies
                temperature: 0.7,
                thinking: {
                    type: 'enabled',
                    budget_tokens: 4000 // Reserve tokens for deep reasoning about strategy design
                },
                system: this.getSystemPrompt(),
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
        }
        catch (error) {
            logger.error('Error generating strategy with LLM:', error);
            throw error;
        }
    }
    /**
     * Generate multiple strategy variations
     */
    async generateStrategyVariations(marketContext, count = 3) {
        this.ensureClient();
        const strategies = [];
        for (let i = 0; i < count; i++) {
            try {
                const strategy = await this.generateStrategy(marketContext);
                strategies.push(strategy);
                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                logger.error(`Error generating strategy variation ${i + 1}:`, error);
            }
        }
        return strategies;
    }
    /**
     * Optimize an existing strategy using LLM
     */
    async optimizeStrategy(strategy, performanceData, marketContext) {
        this.ensureClient();
        try {
            logger.info(`Optimizing strategy ${strategy.name} using LLM...`);
            const prompt = this.buildOptimizationPrompt(strategy, performanceData, marketContext);
            // Use extended thinking for strategy optimization
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 8192,
                temperature: 0.6,
                thinking: {
                    type: 'enabled',
                    budget_tokens: 4000 // Reserve tokens for analyzing performance and optimizing
                },
                system: this.getSystemPrompt(),
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
        }
        catch (error) {
            logger.error('Error optimizing strategy with LLM:', error);
            throw error;
        }
    }
    /**
     * System prompt for strategy generation
     */
    getSystemPrompt() {
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
     * Build prompt for strategy generation
     */
    buildStrategyGenerationPrompt(context) {
        const { symbol, currentPrice, priceChange24h, volume24h, technicalIndicators, marketRegime, sentiment } = context;
        return `Generate a novel trading strategy for ${symbol} based on the following market analysis:

CURRENT MARKET CONDITIONS:
- Symbol: ${symbol}
- Current Price: $${currentPrice.toFixed(2)}
- 24h Price Change: ${priceChange24h.toFixed(2)}%
- 24h Volume: ${volume24h.toLocaleString()}
- Market Regime: ${marketRegime || 'unknown'}
- Sentiment: ${sentiment || 'neutral'}

TECHNICAL INDICATORS:
${technicalIndicators.rsi ? `- RSI: ${technicalIndicators.rsi.toFixed(2)}` : ''}
${technicalIndicators.macd ? `- MACD: Line=${technicalIndicators.macd.line.toFixed(2)}, Signal=${technicalIndicators.macd.signal.toFixed(2)}, Histogram=${technicalIndicators.macd.histogram.toFixed(2)}` : ''}
${technicalIndicators.bollingerBands ? `- Bollinger Bands: Upper=${technicalIndicators.bollingerBands.upper.toFixed(2)}, Middle=${technicalIndicators.bollingerBands.middle.toFixed(2)}, Lower=${technicalIndicators.bollingerBands.lower.toFixed(2)}` : ''}
${technicalIndicators.sma20 ? `- SMA(20): ${technicalIndicators.sma20.toFixed(2)}` : ''}
${technicalIndicators.sma50 ? `- SMA(50): ${technicalIndicators.sma50.toFixed(2)}` : ''}
${technicalIndicators.sma200 ? `- SMA(200): ${technicalIndicators.sma200.toFixed(2)}` : ''}

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
    buildOptimizationPrompt(strategy, performance, context) {
        return `Optimize the following trading strategy based on its performance data:

CURRENT STRATEGY:
- Name: ${strategy.name}
- Type: ${strategy.type}
- Algorithm: ${strategy.algorithm}
- Parameters: ${JSON.stringify(strategy.parameters, null, 2)}

PERFORMANCE DATA:
- Win Rate: ${(performance.winRate * 100).toFixed(2)}%
- Profit Factor: ${performance.profitFactor.toFixed(2)}
- Sharpe Ratio: ${performance.sharpeRatio.toFixed(2)}
- Max Drawdown: ${(performance.maxDrawdown * 100).toFixed(2)}%
- Total Trades: ${performance.totalTrades}

CURRENT MARKET CONDITIONS:
- Symbol: ${context.symbol}
- Current Price: $${context.currentPrice.toFixed(2)}
- 24h Change: ${context.priceChange24h.toFixed(2)}%
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
     * Parse LLM response into structured strategy
     */
    parseStrategyResponse(response, context) {
        try {
            // Extract JSON from response (handle markdown code blocks)
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in LLM response');
            }
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const parsed = JSON.parse(jsonStr);
            // Validate required fields
            const required = ['name', 'description', 'type', 'algorithm', 'parameters', 'entryConditions', 'exitConditions', 'riskManagement'];
            for (const field of required) {
                if (!parsed[field]) {
                    throw new Error(`Missing required field: ${field}`);
                }
            }
            // Ensure parameters include pair and timeframe
            if (!parsed.parameters.pair) {
                parsed.parameters.pair = context.symbol;
            }
            if (!parsed.parameters.timeframe) {
                parsed.parameters.timeframe = '1h';
            }
            // Set defaults for optional fields
            parsed.expectedPerformance = parsed.expectedPerformance || {
                winRate: 0.50,
                profitFactor: 1.5,
                sharpeRatio: 1.0
            };
            parsed.confidence = parsed.confidence || 70;
            parsed.reasoning = parsed.reasoning || 'LLM-generated strategy';
            return parsed;
        }
        catch (error) {
            logger.error('Error parsing LLM strategy response:', error);
            logger.error('Response was:', response);
            throw new Error(`Failed to parse LLM response: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
// Singleton instance - lazy loaded
let llmStrategyGeneratorInstance = null;
/**
 * Get or create the LLM strategy generator singleton
 */
export function getLLMStrategyGenerator() {
    if (!llmStrategyGeneratorInstance) {
        llmStrategyGeneratorInstance = new LLMStrategyGenerator();
    }
    return llmStrategyGeneratorInstance;
}
