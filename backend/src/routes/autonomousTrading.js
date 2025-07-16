import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import autonomousStrategyGenerator from '../services/autonomousStrategyGenerator.js';
import strategyOptimizer from '../services/strategyOptimizer.js';
import profitBankingService from '../services/profitBankingService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * System Control Routes
 */

// Start autonomous trading system
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const { riskTolerance, bankingConfig } = req.body;
    
    // Update configurations if provided
    if (riskTolerance) {
      autonomousStrategyGenerator.riskTolerance = { 
        ...autonomousStrategyGenerator.riskTolerance, 
        ...riskTolerance 
      };
    }
    
    if (bankingConfig) {
      profitBankingService.updateConfig(bankingConfig);
    }
    
    // Start all services
    await autonomousStrategyGenerator.start();
    
    res.json({
      success: true,
      message: 'Autonomous trading system started successfully',
      configuration: {
        riskTolerance: autonomousStrategyGenerator.riskTolerance,
        bankingConfig: profitBankingService.bankingConfig
      }
    });
  } catch (error) {
    logger.error('Error starting autonomous trading system:', error);
    res.status(500).json({
      error: 'Failed to start autonomous trading system',
      details: error.message
    });
  }
});

// Stop autonomous trading system
router.post('/stop', authenticateToken, async (req, res) => {
  try {
    await autonomousStrategyGenerator.stop();
    
    res.json({
      success: true,
      message: 'Autonomous trading system stopped successfully'
    });
  } catch (error) {
    logger.error('Error stopping autonomous trading system:', error);
    res.status(500).json({
      error: 'Failed to stop autonomous trading system',
      details: error.message
    });
  }
});

// Get system status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const systemStatus = {
      isRunning: autonomousStrategyGenerator.isRunning,
      generationCount: autonomousStrategyGenerator.generationCount,
      totalStrategies: autonomousStrategyGenerator.strategies.size,
      activeStrategies: autonomousStrategyGenerator.activeStrategies.size,
      performanceMetrics: autonomousStrategyGenerator.performanceMetrics,
      optimizationStats: strategyOptimizer.getStats(),
      bankingStats: profitBankingService.getStats()
    };
    
    res.json({
      success: true,
      systemStatus
    });
  } catch (error) {
    logger.error('Error getting system status:', error);
    res.status(500).json({
      error: 'Failed to get system status',
      details: error.message
    });
  }
});

// Emergency stop
router.post('/emergency-stop', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    
    await autonomousStrategyGenerator.stop();
    profitBankingService.setBankingEnabled(false);
    
    logger.warn(`🚨 Emergency stop triggered: ${reason}`);
    
    res.json({
      success: true,
      message: 'Emergency stop executed successfully',
      reason: reason
    });
  } catch (error) {
    logger.error('Error executing emergency stop:', error);
    res.status(500).json({
      error: 'Failed to execute emergency stop',
      details: error.message
    });
  }
});

/**
 * Strategy Management Routes
 */

// Get all strategies
router.get('/strategies', authenticateToken, async (req, res) => {
  try {
    const { status, generation, limit = 50, offset = 0 } = req.query;
    
    let strategies = Array.from(autonomousStrategyGenerator.strategies.values());
    
    // Filter by status if provided
    if (status) {
      strategies = strategies.filter(s => s.status === status);
    }
    
    // Filter by generation if provided
    if (generation) {
      strategies = strategies.filter(s => s.generation === parseInt(generation));
    }
    
    // Sort by fitness score
    strategies.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));
    
    // Apply pagination
    const paginatedStrategies = strategies.slice(offset, offset + parseInt(limit));
    
    res.json({
      success: true,
      strategies: paginatedStrategies,
      total: strategies.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Error getting strategies:', error);
    res.status(500).json({
      error: 'Failed to get strategies',
      details: error.message
    });
  }
});

// Get specific strategy
router.get('/strategies/:strategyId', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    const strategy = autonomousStrategyGenerator.strategies.get(strategyId);
    
    if (!strategy) {
      return res.status(404).json({
        error: 'Strategy not found'
      });
    }
    
    res.json({
      success: true,
      strategy
    });
  } catch (error) {
    logger.error('Error getting strategy:', error);
    res.status(500).json({
      error: 'Failed to get strategy',
      details: error.message
    });
  }
});

// Manually retire strategy
router.post('/strategies/:strategyId/retire', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { reason } = req.body;
    
    const strategy = autonomousStrategyGenerator.strategies.get(strategyId);
    
    if (!strategy) {
      return res.status(404).json({
        error: 'Strategy not found'
      });
    }
    
    // Retire strategy
    await strategyOptimizer.retireStrategy(strategy, { reason: reason || 'Manual retirement' });
    
    res.json({
      success: true,
      message: 'Strategy retired successfully',
      strategyId: strategyId
    });
  } catch (error) {
    logger.error('Error retiring strategy:', error);
    res.status(500).json({
      error: 'Failed to retire strategy',
      details: error.message
    });
  }
});

// Get strategy performance history
router.get('/strategies/:strategyId/performance', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { timeframe = '24h' } = req.query;
    
    // This would typically query the database for historical performance
    // For now, return mock data
    const performanceHistory = [
      { timestamp: new Date(), profit: 0.05, winRate: 0.65, trades: 10 },
      { timestamp: new Date(Date.now() - 60 * 60 * 1000), profit: 0.03, winRate: 0.60, trades: 8 }
    ];
    
    res.json({
      success: true,
      strategyId,
      timeframe,
      performanceHistory
    });
  } catch (error) {
    logger.error('Error getting strategy performance:', error);
    res.status(500).json({
      error: 'Failed to get strategy performance',
      details: error.message
    });
  }
});

/**
 * Profit Banking Routes
 */

// Get banking status
router.get('/banking/status', authenticateToken, async (req, res) => {
  try {
    const bankingStats = profitBankingService.getStats();
    
    res.json({
      success: true,
      bankingStats
    });
  } catch (error) {
    logger.error('Error getting banking status:', error);
    res.status(500).json({
      error: 'Failed to get banking status',
      details: error.message
    });
  }
});

// Manual banking
router.post('/banking/manual', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: 'Invalid amount provided'
      });
    }
    
    await profitBankingService.manualBanking(amount);
    
    res.json({
      success: true,
      message: `Successfully banked ${amount} USDT`,
      amount: amount
    });
  } catch (error) {
    logger.error('Error executing manual banking:', error);
    res.status(500).json({
      error: 'Failed to execute manual banking',
      details: error.message
    });
  }
});

// Get banking history
router.get('/banking/history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const history = profitBankingService.getBankingHistory(parseInt(limit));
    
    res.json({
      success: true,
      history,
      total: history.length
    });
  } catch (error) {
    logger.error('Error getting banking history:', error);
    res.status(500).json({
      error: 'Failed to get banking history',
      details: error.message
    });
  }
});

// Update banking configuration
router.post('/banking/config', authenticateToken, async (req, res) => {
  try {
    const { bankingConfig } = req.body;
    
    if (!bankingConfig) {
      return res.status(400).json({
        error: 'Banking configuration is required'
      });
    }
    
    profitBankingService.updateConfig(bankingConfig);
    
    res.json({
      success: true,
      message: 'Banking configuration updated successfully',
      config: profitBankingService.bankingConfig
    });
  } catch (error) {
    logger.error('Error updating banking configuration:', error);
    res.status(500).json({
      error: 'Failed to update banking configuration',
      details: error.message
    });
  }
});

// Enable/disable banking
router.post('/banking/toggle', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'Enabled flag must be a boolean'
      });
    }
    
    profitBankingService.setBankingEnabled(enabled);
    
    res.json({
      success: true,
      message: `Banking ${enabled ? 'enabled' : 'disabled'} successfully`,
      enabled
    });
  } catch (error) {
    logger.error('Error toggling banking:', error);
    res.status(500).json({
      error: 'Failed to toggle banking',
      details: error.message
    });
  }
});

/**
 * Configuration Routes
 */

// Get current configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const config = {
      riskTolerance: autonomousStrategyGenerator.riskTolerance,
      generationConfig: autonomousStrategyGenerator.generationConfig,
      bankingConfig: profitBankingService.bankingConfig,
      optimizationThresholds: strategyOptimizer.thresholds
    };
    
    res.json({
      success: true,
      config
    });
  } catch (error) {
    logger.error('Error getting configuration:', error);
    res.status(500).json({
      error: 'Failed to get configuration',
      details: error.message
    });
  }
});

// Update risk tolerance
router.post('/config/risk-tolerance', authenticateToken, async (req, res) => {
  try {
    const { riskTolerance } = req.body;
    
    if (!riskTolerance) {
      return res.status(400).json({
        error: 'Risk tolerance configuration is required'
      });
    }
    
    autonomousStrategyGenerator.riskTolerance = {
      ...autonomousStrategyGenerator.riskTolerance,
      ...riskTolerance
    };
    
    res.json({
      success: true,
      message: 'Risk tolerance updated successfully',
      riskTolerance: autonomousStrategyGenerator.riskTolerance
    });
  } catch (error) {
    logger.error('Error updating risk tolerance:', error);
    res.status(500).json({
      error: 'Failed to update risk tolerance',
      details: error.message
    });
  }
});

// Update optimization thresholds
router.post('/config/optimization-thresholds', authenticateToken, async (req, res) => {
  try {
    const { thresholds } = req.body;
    
    if (!thresholds) {
      return res.status(400).json({
        error: 'Optimization thresholds are required'
      });
    }
    
    strategyOptimizer.updateThresholds(thresholds);
    
    res.json({
      success: true,
      message: 'Optimization thresholds updated successfully',
      thresholds: strategyOptimizer.thresholds
    });
  } catch (error) {
    logger.error('Error updating optimization thresholds:', error);
    res.status(500).json({
      error: 'Failed to update optimization thresholds',
      details: error.message
    });
  }
});

/**
 * Analytics Routes
 */

// Get system performance analytics
router.get('/analytics/performance', authenticateToken, async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    
    const analytics = {
      totalProfit: autonomousStrategyGenerator.performanceMetrics.totalProfit,
      totalTrades: autonomousStrategyGenerator.performanceMetrics.totalTrades,
      winRate: autonomousStrategyGenerator.performanceMetrics.winRate,
      sharpeRatio: autonomousStrategyGenerator.performanceMetrics.sharpeRatio,
      maxDrawdown: autonomousStrategyGenerator.performanceMetrics.maxDrawdown,
      bankedProfits: autonomousStrategyGenerator.performanceMetrics.bankedProfits,
      generationCount: autonomousStrategyGenerator.generationCount,
      activeStrategies: autonomousStrategyGenerator.activeStrategies.size,
      optimizationStats: strategyOptimizer.getStats()
    };
    
    res.json({
      success: true,
      timeframe,
      analytics
    });
  } catch (error) {
    logger.error('Error getting performance analytics:', error);
    res.status(500).json({
      error: 'Failed to get performance analytics',
      details: error.message
    });
  }
});

// Get generation statistics
router.get('/analytics/generations', authenticateToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // This would typically query the database for generation statistics
    // For now, return mock data
    const generationStats = [
      {
        generation: autonomousStrategyGenerator.generationCount,
        strategiesCreated: 5,
        averageFitness: 0.65,
        bestFitness: 0.85,
        diversityScore: 0.78,
        timestamp: new Date()
      }
    ];
    
    res.json({
      success: true,
      generationStats,
      currentGeneration: autonomousStrategyGenerator.generationCount
    });
  } catch (error) {
    logger.error('Error getting generation statistics:', error);
    res.status(500).json({
      error: 'Failed to get generation statistics',
      details: error.message
    });
  }
});

/**
 * WebSocket Events Information
 */
router.get('/ws-events', authenticateToken, async (req, res) => {
  try {
    const events = [
      {
        name: 'generationComplete',
        description: 'Emitted when a strategy generation cycle completes',
        payload: '{ generation, totalStrategies, activeStrategies, performance }'
      },
      {
        name: 'profitBanked',
        description: 'Emitted when profits are banked to spot account',
        payload: '{ amount, totalBanked, totalProfit, transferId }'
      },
      {
        name: 'strategyPromoted',
        description: 'Emitted when a strategy is promoted to live trading',
        payload: '{ strategyId, confidenceScore, strategy }'
      },
      {
        name: 'strategyRetired',
        description: 'Emitted when a strategy is retired',
        payload: '{ strategyId, reason, performance }'
      },
      {
        name: 'emergencyStop',
        description: 'Emitted when emergency stop is triggered',
        payload: '{ drawdown, currentBalance, reason }'
      },
      {
        name: 'bankingFailed',
        description: 'Emitted when profit banking fails',
        payload: '{ amount, error, totalProfit }'
      }
    ];
    
    res.json({
      success: true,
      events,
      usage: 'Connect to the main WebSocket server and listen for these events'
    });
  } catch (error) {
    logger.error('Error getting WebSocket events:', error);
    res.status(500).json({
      error: 'Failed to get WebSocket events',
      details: error.message
    });
  }
});

export default router;