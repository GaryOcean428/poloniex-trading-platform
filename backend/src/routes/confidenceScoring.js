import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import confidenceScoringService from '../services/confidenceScoringService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Calculate confidence score for a strategy
 * POST /api/confidence-scoring/calculate
 */
router.post('/calculate', authenticateToken, async (req, res) => {
  try {
    const { strategyName, symbol, timeframe } = req.body;

    // Validate required fields
    if (!strategyName || !symbol || !timeframe) {
      return res.status(400).json({
        error: 'Missing required fields: strategyName, symbol, timeframe'
      });
    }

    // Validate Poloniex symbol format
    if (!symbol.includes('USDT')) {
      return res.status(400).json({
        error: 'Invalid Poloniex symbol format. Must be like BTCUSDT, ETHUSDT, etc.'
      });
    }

    // Validate timeframe
    const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({
        error: `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`
      });
    }

    const confidenceAssessment = await confidenceScoringService.calculateConfidenceScore(
      strategyName,
      symbol,
      timeframe
    );

    res.json({
      success: true,
      confidenceAssessment
    });
  } catch (error) {
    logger.error('Error calculating confidence score:', error);
    res.status(500).json({
      error: 'Failed to calculate confidence score',
      details: error.message
    });
  }
});

/**
 * Get confidence score for a strategy
 * GET /api/confidence-scoring/score/:strategyName/:symbol/:timeframe
 */
router.get('/score/:strategyName/:symbol/:timeframe', authenticateToken, async (req, res) => {
  try {
    const { strategyName, symbol, timeframe } = req.params;

    const confidenceScore = confidenceScoringService.getConfidenceScore(
      strategyName,
      symbol,
      timeframe
    );

    if (!confidenceScore) {
      return res.status(404).json({
        error: 'Confidence score not found. Try calculating it first.'
      });
    }

    res.json({
      success: true,
      confidenceScore
    });
  } catch (error) {
    logger.error('Error fetching confidence score:', error);
    res.status(500).json({
      error: 'Failed to fetch confidence score',
      details: error.message
    });
  }
});

/**
 * Get all confidence scores
 * GET /api/confidence-scoring/scores
 */
router.get('/scores', authenticateToken, async (req, res) => {
  try {
    const { strategyName, symbol, minConfidence, maxConfidence } = req.query;

    let confidenceScores = confidenceScoringService.getAllConfidenceScores();

    // Filter by strategy name if provided
    if (strategyName) {
      confidenceScores = confidenceScores.filter(score => 
        score.strategyName === strategyName
      );
    }

    // Filter by symbol if provided
    if (symbol) {
      confidenceScores = confidenceScores.filter(score => 
        score.symbol === symbol
      );
    }

    // Filter by confidence range if provided
    if (minConfidence || maxConfidence) {
      confidenceScores = confidenceScores.filter(score => {
        const confidence = score.confidenceScore;
        const minCheck = minConfidence ? confidence >= parseInt(minConfidence) : true;
        const maxCheck = maxConfidence ? confidence <= parseInt(maxConfidence) : true;
        return minCheck && maxCheck;
      });
    }

    // Sort by confidence score descending
    confidenceScores.sort((a, b) => b.confidenceScore - a.confidenceScore);

    res.json({
      success: true,
      confidenceScores,
      total: confidenceScores.length
    });
  } catch (error) {
    logger.error('Error fetching confidence scores:', error);
    res.status(500).json({
      error: 'Failed to fetch confidence scores',
      details: error.message
    });
  }
});

/**
 * Get confidence scores for specific strategy
 * GET /api/confidence-scoring/strategy/:strategyName
 */
router.get('/strategy/:strategyName', authenticateToken, async (req, res) => {
  try {
    const { strategyName } = req.params;
    const confidenceScores = confidenceScoringService.getConfidenceScoresForStrategy(strategyName);

    // Calculate strategy summary
    const summary = {
      strategyName,
      totalSymbols: confidenceScores.length,
      averageConfidence: confidenceScores.length > 0 ? 
        confidenceScores.reduce((sum, score) => sum + score.confidenceScore, 0) / confidenceScores.length : 0,
      highConfidenceCount: confidenceScores.filter(score => score.confidenceScore >= 80).length,
      mediumConfidenceCount: confidenceScores.filter(score => score.confidenceScore >= 60 && score.confidenceScore < 80).length,
      lowConfidenceCount: confidenceScores.filter(score => score.confidenceScore < 60).length,
      lastCalculated: confidenceScores.length > 0 ? 
        Math.max(...confidenceScores.map(score => new Date(score.calculatedAt).getTime())) : null
    };

    res.json({
      success: true,
      summary,
      confidenceScores
    });
  } catch (error) {
    logger.error('Error fetching strategy confidence scores:', error);
    res.status(500).json({
      error: 'Failed to fetch strategy confidence scores',
      details: error.message
    });
  }
});

/**
 * Get market conditions for symbol
 * GET /api/confidence-scoring/market-conditions/:symbol
 */
router.get('/market-conditions/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { refresh } = req.query;

    let marketConditions = confidenceScoringService.getMarketConditions(symbol);

    // Refresh market conditions if requested or if data is stale
    if (refresh === 'true' || !marketConditions || 
        (Date.now() - new Date(marketConditions.timestamp).getTime() > 5 * 60 * 1000)) {
      marketConditions = await confidenceScoringService.analyzeMarketConditions(symbol);
    }

    if (!marketConditions) {
      return res.status(404).json({
        error: 'Market conditions not available for this symbol'
      });
    }

    res.json({
      success: true,
      marketConditions
    });
  } catch (error) {
    logger.error('Error fetching market conditions:', error);
    res.status(500).json({
      error: 'Failed to fetch market conditions',
      details: error.message
    });
  }
});

/**
 * Get risk assessment for strategy and symbol
 * GET /api/confidence-scoring/risk-assessment/:strategyName/:symbol
 */
router.get('/risk-assessment/:strategyName/:symbol', authenticateToken, async (req, res) => {
  try {
    const { strategyName, symbol } = req.params;
    const { timeframe = '1h' } = req.query;

    const confidenceScore = confidenceScoringService.getConfidenceScore(
      strategyName,
      symbol,
      timeframe
    );

    if (!confidenceScore) {
      // Calculate if not available
      const assessment = await confidenceScoringService.calculateConfidenceScore(
        strategyName,
        symbol,
        timeframe
      );
      
      return res.json({
        success: true,
        riskAssessment: {
          strategyName,
          symbol,
          timeframe,
          confidenceScore: assessment.confidenceScore,
          riskScore: assessment.riskScore,
          recommendedPositionSize: assessment.recommendedPositionSize,
          riskLevel: assessment.riskScore > 70 ? 'high' : assessment.riskScore > 50 ? 'medium' : 'low',
          tradingRecommendation: assessment.confidenceScore >= 80 ? 'strongly_recommended' :
                                assessment.confidenceScore >= 60 ? 'recommended' :
                                assessment.confidenceScore >= 40 ? 'caution' : 'not_recommended',
          warnings: assessment.warnings,
          marketConditions: assessment.marketConditions
        }
      });
    }

    const riskAssessment = {
      strategyName,
      symbol,
      timeframe,
      confidenceScore: confidenceScore.confidenceScore,
      riskScore: confidenceScore.riskScore,
      recommendedPositionSize: confidenceScore.recommendedPositionSize,
      riskLevel: confidenceScore.riskScore > 70 ? 'high' : confidenceScore.riskScore > 50 ? 'medium' : 'low',
      tradingRecommendation: confidenceScore.confidenceScore >= 80 ? 'strongly_recommended' :
                            confidenceScore.confidenceScore >= 60 ? 'recommended' :
                            confidenceScore.confidenceScore >= 40 ? 'caution' : 'not_recommended',
      warnings: confidenceScore.warnings,
      marketConditions: confidenceScore.marketConditions,
      lastCalculated: confidenceScore.calculatedAt
    };

    res.json({
      success: true,
      riskAssessment
    });
  } catch (error) {
    logger.error('Error fetching risk assessment:', error);
    res.status(500).json({
      error: 'Failed to fetch risk assessment',
      details: error.message
    });
  }
});

/**
 * Get optimal position size for strategy
 * POST /api/confidence-scoring/position-size
 */
router.post('/position-size', authenticateToken, async (req, res) => {
  try {
    const { 
      strategyName, 
      symbol, 
      timeframe = '1h',
      portfolioValue,
      maxRiskPerTrade = 0.02,
      stopLossPercent = 0.02
    } = req.body;

    if (!strategyName || !symbol || !portfolioValue) {
      return res.status(400).json({
        error: 'Missing required fields: strategyName, symbol, portfolioValue'
      });
    }

    const confidenceScore = confidenceScoringService.getConfidenceScore(
      strategyName,
      symbol,
      timeframe
    );

    if (!confidenceScore) {
      return res.status(404).json({
        error: 'Confidence score not found. Calculate confidence score first.'
      });
    }

    // Calculate position size based on Kelly criterion and confidence
    const kellyFraction = confidenceScore.recommendedPositionSize;
    const riskAmount = portfolioValue * maxRiskPerTrade;
    const marketConditions = confidenceScore.marketConditions;
    
    // Adjust for market conditions
    let adjustedKelly = kellyFraction;
    if (marketConditions) {
      if (marketConditions.volatility.level === 'high') {
        adjustedKelly *= 0.7;
      }
      if (marketConditions.liquidity.level === 'low') {
        adjustedKelly *= 0.8;
      }
      if (marketConditions.riskLevel === 'high') {
        adjustedKelly *= 0.6;
      }
    }

    // Calculate optimal position size
    const confidenceAdjustedSize = portfolioValue * adjustedKelly;
    const riskAdjustedSize = riskAmount / stopLossPercent;
    
    // Use the more conservative of the two
    const optimalSize = Math.min(confidenceAdjustedSize, riskAdjustedSize);
    
    // Apply safety limits
    const maxSize = portfolioValue * 0.1; // Max 10% of portfolio
    const minSize = portfolioValue * 0.005; // Min 0.5% of portfolio
    
    const finalSize = Math.min(Math.max(optimalSize, minSize), maxSize);
    const sizeAsPercent = (finalSize / portfolioValue) * 100;

    res.json({
      success: true,
      positionSizing: {
        strategyName,
        symbol,
        timeframe,
        portfolioValue,
        confidenceScore: confidenceScore.confidenceScore,
        recommendedPositionSize: finalSize,
        positionSizePercent: sizeAsPercent,
        kellyFraction: adjustedKelly,
        riskAmount,
        calculations: {
          confidenceAdjustedSize,
          riskAdjustedSize,
          appliedLimits: {
            maxSize,
            minSize,
            finalSize
          }
        },
        marketAdjustments: marketConditions ? {
          volatilityAdjustment: marketConditions.volatility.level,
          liquidityAdjustment: marketConditions.liquidity.level,
          riskLevelAdjustment: marketConditions.riskLevel
        } : null
      }
    });
  } catch (error) {
    logger.error('Error calculating position size:', error);
    res.status(500).json({
      error: 'Failed to calculate position size',
      details: error.message
    });
  }
});

/**
 * Get confidence scoring service status
 * GET /api/confidence-scoring/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = confidenceScoringService.getServiceStatus();
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('Error fetching service status:', error);
    res.status(500).json({
      error: 'Failed to fetch service status',
      details: error.message
    });
  }
});

/**
 * Bulk update confidence scores
 * POST /api/confidence-scoring/bulk-update
 */
router.post('/bulk-update', authenticateToken, async (req, res) => {
  try {
    const { strategies } = req.body;

    if (!strategies || !Array.isArray(strategies)) {
      return res.status(400).json({
        error: 'Missing or invalid strategies array'
      });
    }

    const results = [];
    const errors = [];

    for (const strategy of strategies) {
      try {
        const { strategyName, symbol, timeframe } = strategy;
        
        if (!strategyName || !symbol || !timeframe) {
          errors.push({
            strategy,
            error: 'Missing required fields: strategyName, symbol, timeframe'
          });
          continue;
        }

        const confidenceAssessment = await confidenceScoringService.calculateConfidenceScore(
          strategyName,
          symbol,
          timeframe
        );

        results.push({
          strategyName,
          symbol,
          timeframe,
          confidenceScore: confidenceAssessment.confidenceScore,
          success: true
        });
      } catch (error) {
        errors.push({
          strategy,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      results,
      errors,
      summary: {
        total: strategies.length,
        successful: results.length,
        failed: errors.length
      }
    });
  } catch (error) {
    logger.error('Error in bulk update:', error);
    res.status(500).json({
      error: 'Failed to perform bulk update',
      details: error.message
    });
  }
});

/**
 * Get confidence scoring configuration
 * GET /api/confidence-scoring/config
 */
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const config = {
      scoringParameters: confidenceScoringService.scoringParameters,
      supportedSymbols: [
        'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT',
        'LTCUSDT', 'XRPUSDT', 'BCHUSDT', 'EOSUSDT', 'ETCUSDT',
        'TRXUSDT', 'XLMUSDT', 'ATOMUSDT', 'VETUSDT', 'FILUSDT'
      ],
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
      confidenceThresholds: {
        high: 80,
        medium: 60,
        low: 40
      },
      riskLevels: {
        low: 'Score < 40',
        medium: '40 <= Score < 70',
        high: 'Score >= 70'
      },
      positionSizingLimits: {
        min: 0.005,
        max: 0.10,
        base: 0.02
      }
    };

    res.json({
      success: true,
      config
    });
  } catch (error) {
    logger.error('Error fetching config:', error);
    res.status(500).json({
      error: 'Failed to fetch config',
      details: error.message
    });
  }
});

/**
 * Get WebSocket events information
 * GET /api/confidence-scoring/ws-events
 */
router.get('/ws-events', authenticateToken, async (req, res) => {
  try {
    const events = [
      {
        name: 'confidenceScoreCalculated',
        description: 'Emitted when a confidence score is calculated',
        payload: 'confidenceAssessment object'
      },
      {
        name: 'marketConditionsUpdated',
        description: 'Emitted when market conditions are updated',
        payload: 'marketConditions object'
      },
      {
        name: 'riskAssessmentAlert',
        description: 'Emitted when risk levels change significantly',
        payload: '{ strategyName, symbol, riskLevel, change }'
      }
    ];

    res.json({
      success: true,
      events,
      usage: 'Connect to the main WebSocket server and listen for these events'
    });
  } catch (error) {
    logger.error('Error fetching WebSocket events:', error);
    res.status(500).json({
      error: 'Failed to fetch WebSocket events',
      details: error.message
    });
  }
});

export default router;