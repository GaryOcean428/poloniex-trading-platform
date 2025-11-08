import express from 'express';
import { getLLMStrategyGenerator } from '../services/llmStrategyGenerator.js';
import { logger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();
/**
 * GET /api/llm-strategies/status
 * Check if LLM service is available (public endpoint, no auth required)
 */
router.get('/status', async (req, res) => {
    try {
        const generator = getLLMStrategyGenerator();
        const isAvailable = generator.isAvailable();
        res.json({
            available: isAvailable,
            message: isAvailable
                ? 'LLM strategy generation is available'
                : 'ANTHROPIC_API_KEY is not configured',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger.error('Error checking LLM status:', error);
        res.status(500).json({
            available: false,
            message: 'Error checking LLM service status',
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
/**
 * POST /api/llm-strategies/generate
 * Generate a new trading strategy using LLM
 */
router.post('/generate', authenticateToken, async (req, res) => {
    try {
        const marketContext = req.body.marketContext;
        if (!marketContext || !marketContext.symbol) {
            return res.status(400).json({ error: 'Market context with symbol is required' });
        }
        const generator = getLLMStrategyGenerator();
        if (!generator.isAvailable()) {
            return res.status(503).json({
                error: 'LLM service unavailable',
                message: 'ANTHROPIC_API_KEY is not configured. Please contact administrator.'
            });
        }
        logger.info(`Generating LLM strategy for ${marketContext.symbol}`);
        const strategy = await generator.generateStrategy(marketContext);
        res.json({
            success: true,
            strategy
        });
    }
    catch (error) {
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
        const { marketContext, count = 3 } = req.body;
        if (!marketContext || !marketContext.symbol) {
            return res.status(400).json({ error: 'Market context with symbol is required' });
        }
        if (count < 1 || count > 5) {
            return res.status(400).json({ error: 'Count must be between 1 and 5' });
        }
        const generator = getLLMStrategyGenerator();
        if (!generator.isAvailable()) {
            return res.status(503).json({
                error: 'LLM service unavailable',
                message: 'ANTHROPIC_API_KEY is not configured. Please contact administrator.'
            });
        }
        logger.info(`Generating ${count} LLM strategy variations for ${marketContext.symbol}`);
        const strategies = await generator.generateStrategyVariations(marketContext, count);
        res.json({
            success: true,
            strategies,
            count: strategies.length
        });
    }
    catch (error) {
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
        const generator = getLLMStrategyGenerator();
        if (!generator.isAvailable()) {
            return res.status(503).json({
                error: 'LLM service unavailable',
                message: 'ANTHROPIC_API_KEY is not configured. Please contact administrator.'
            });
        }
        logger.info(`Optimizing strategy ${strategy.name} using LLM`);
        const optimizedStrategy = await generator.optimizeStrategy(strategy, performanceData, marketContext);
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
    }
    catch (error) {
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
        const marketContext = req.body.marketContext;
        if (!marketContext || !marketContext.symbol) {
            return res.status(400).json({ error: 'Market context with symbol is required' });
        }
        // Use LLM to analyze market and suggest strategy types
        const analysis = await analyzeMarketConditions(marketContext);
        res.json({
            success: true,
            analysis
        });
    }
    catch (error) {
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
async function analyzeMarketConditions(context) {
    const { currentPrice, priceChange24h, technicalIndicators } = context;
    // Determine market regime
    let marketRegime = 'ranging';
    if (Math.abs(priceChange24h) > 5) {
        marketRegime = priceChange24h > 0 ? 'trending_up' : 'trending_down';
    }
    if (technicalIndicators.rsi && (technicalIndicators.rsi > 70 || technicalIndicators.rsi < 30)) {
        marketRegime = 'volatile';
    }
    // Determine sentiment
    let sentiment = 'neutral';
    if (priceChange24h > 3)
        sentiment = 'bullish';
    if (priceChange24h < -3)
        sentiment = 'bearish';
    // Suggest strategy types
    const suggestedStrategies = [];
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
