import express from 'express';
import { llmStrategyGenerator, type MarketContext } from '../services/llmStrategyGenerator.js';
import { logger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/llm-strategies/generate
 * Generate a new trading strategy using LLM
 */
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const marketContext: MarketContext = req.body.marketContext;

    if (!marketContext || !marketContext.symbol) {
      return res.status(400).json({ error: 'Market context with symbol is required' });
    }

    logger.info(`Generating LLM strategy for ${marketContext.symbol}`);

    const strategy = await llmStrategyGenerator.generateStrategy(marketContext);

    res.json({
      success: true,
      strategy
    });

  } catch (error) {
    logger.error('Error in /generate endpoint:', error);
    res.status(500).json({
      error: 'Failed to generate strategy',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/llm-strategies/generate-variations
 * Generate multiple strategy variations
 */
router.post('/generate-variations', authenticateToken, async (req, res) => {
  try {
    const { marketContext, count = 3 }: { marketContext: MarketContext; count?: number } = req.body;

    if (!marketContext || !marketContext.symbol) {
      return res.status(400).json({ error: 'Market context with symbol is required' });
    }

    if (count < 1 || count > 5) {
      return res.status(400).json({ error: 'Count must be between 1 and 5' });
    }

    logger.info(`Generating ${count} LLM strategy variations for ${marketContext.symbol}`);

    const strategies = await llmStrategyGenerator.generateStrategyVariations(marketContext, count);

    res.json({
      success: true,
      strategies,
      count: strategies.length
    });

  } catch (error) {
    logger.error('Error in /generate-variations endpoint:', error);
    res.status(500).json({
      error: 'Failed to generate strategy variations',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/llm-strategies/optimize
 * Optimize an existing strategy using LLM
 */
router.post('/optimize', authenticateToken, async (req, res) => {
  try {
    const { strategy, performanceData, marketContext } = req.body;

    if (!strategy || !performanceData || !marketContext) {
      return res.status(400).json({
        error: 'Strategy, performance data, and market context are required'
      });
    }

    logger.info(`Optimizing strategy ${strategy.name} using LLM`);

    const optimizedStrategy = await llmStrategyGenerator.optimizeStrategy(
      strategy,
      performanceData,
      marketContext
    );

    res.json({
      success: true,
      optimizedStrategy,
      improvements: {
        original: {
          winRate: performanceData.winRate,
          sharpeRatio: performanceData.sharpeRatio,
          maxDrawdown: performanceData.maxDrawdown
        },
        expected: {
          winRate: optimizedStrategy.expectedPerformance.winRate,
          sharpeRatio: optimizedStrategy.expectedPerformance.sharpeRatio,
          maxDrawdown: optimizedStrategy.riskManagement.maxDrawdown
        }
      }
    });

  } catch (error) {
    logger.error('Error in /optimize endpoint:', error);
    res.status(500).json({
      error: 'Failed to optimize strategy',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/llm-strategies/analyze-market
 * Analyze market conditions and suggest strategy types
 */
router.post('/analyze-market', authenticateToken, async (req, res) => {
  try {
    const marketContext: MarketContext = req.body.marketContext;

    if (!marketContext || !marketContext.symbol) {
      return res.status(400).json({ error: 'Market context with symbol is required' });
    }

    // Use LLM to analyze market and suggest strategy types
    const analysis = await analyzeMarketConditions(marketContext);

    res.json({
      success: true,
      analysis
    });

  } catch (error) {
    logger.error('Error in /analyze-market endpoint:', error);
    res.status(500).json({
      error: 'Failed to analyze market',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Helper function to analyze market conditions
 */
async function analyzeMarketConditions(context: MarketContext) {
  const { currentPrice, priceChange24h, technicalIndicators } = context;

  // Determine market regime
  let marketRegime: MarketContext['marketRegime'] = 'ranging';
  if (Math.abs(priceChange24h) > 5) {
    marketRegime = priceChange24h > 0 ? 'trending_up' : 'trending_down';
  }
  if (technicalIndicators.rsi && (technicalIndicators.rsi > 70 || technicalIndicators.rsi < 30)) {
    marketRegime = 'volatile';
  }

  // Determine sentiment
  let sentiment: MarketContext['sentiment'] = 'neutral';
  if (priceChange24h > 3) sentiment = 'bullish';
  if (priceChange24h < -3) sentiment = 'bearish';

  // Suggest strategy types
  const suggestedStrategies: string[] = [];
  if (marketRegime === 'trending_up' || marketRegime === 'trending_down') {
    suggestedStrategies.push('trend_following', 'momentum');
  }
  if (marketRegime === 'ranging') {
    suggestedStrategies.push('mean_reversion', 'scalping');
  }
  if (marketRegime === 'volatile') {
    suggestedStrategies.push('breakout', 'swing');
  }

  return {
    marketRegime,
    sentiment,
    suggestedStrategies,
    technicalSummary: {
      rsi: technicalIndicators.rsi,
      macd: technicalIndicators.macd,
      trend: marketRegime,
      volatility: marketRegime === 'volatile' ? 'high' : 'normal'
    },
    recommendations: [
      `Market is ${marketRegime}, consider ${suggestedStrategies.join(' or ')} strategies`,
      sentiment === 'bullish' ? 'Look for long opportunities' : sentiment === 'bearish' ? 'Consider short positions' : 'Wait for clear signals',
      technicalIndicators.rsi && technicalIndicators.rsi > 70 ? 'RSI overbought - potential reversal' : technicalIndicators.rsi && technicalIndicators.rsi < 30 ? 'RSI oversold - potential bounce' : 'RSI neutral'
    ]
  };
}

export default router;
