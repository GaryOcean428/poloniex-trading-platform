import express, { Request, Response } from 'express';
import { Strategy, StrategyParameters } from '@shared/types/strategy';

const router = express.Router();

// Type for request query parameters
interface StrategyQueryParams {
  active?: string;
}

// Type for creating a new strategy
interface CreateStrategyRequest {
  name: string;
  type: 'manual' | 'automated' | 'ml' | 'dqn';
  algorithm?: 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom';
  parameters: StrategyParameters;
}

// Type for updating a strategy
interface UpdateStrategyRequest extends Partial<CreateStrategyRequest> {
  active?: boolean;
}

// Mock in-memory storage for development/testing only
// TODO: Replace with database queries for production
// This mock data should only be used when NODE_ENV !== 'production'
if (process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Mock strategies data should not be used in production. Implement database-backed storage.');
}

const strategies: Strategy[] = [
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

/**
 * GET /strategies
 * List all strategies
 * @returns {Array<Strategy>} Array of strategy objects conforming to the shared Strategy interface
 */
router.get('/', (req: Request<{}, {}, {}, StrategyQueryParams>, res: Response) => {
  try {
    // Filter by active status if provided
    const { active } = req.query;
    let filteredStrategies = strategies;
    
    if (active !== undefined) {
      const isActive = active === 'true';
      filteredStrategies = strategies.filter(strategy => strategy.active === isActive);
    }
    
    res.json({
      success: true,
      data: filteredStrategies,
      count: filteredStrategies.length
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to fetch strategies',
      message: errorMessage
    });
  }
});

/**
 * GET /strategies/:id
 * Get a specific strategy by ID
 * @param {string} id - Strategy ID
 * @returns {Strategy} Strategy object conforming to the shared Strategy interface
 */
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const strategy = strategies.find(s => s.id === id);
    
    if (!strategy) {
      res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
      return;
    }
    
    res.json({
      success: true,
      data: strategy
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to fetch strategy',
      message: errorMessage
    });
  }
});

/**
 * POST /strategies
 * Create a new strategy
 * @body {CreateStrategyRequest} Strategy data conforming to the shared Strategy interface
 * @returns {Strategy} Created strategy object
 */
router.post('/', (req: Request<{}, {}, CreateStrategyRequest>, res: Response) => {
  try {
    const { name, type, algorithm, parameters } = req.body;
    
    // Validate required fields
    if (!name || !type || !algorithm || !parameters) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, type, algorithm, parameters'
      });
      return;
    }
    
    // Create new strategy following the unified Strategy interface
    const newStrategy: Strategy = {
      id: (strategies.length + 1).toString(),
      name,
      type,
      algorithm,
      active: true,
      parameters,
      performance: {
        totalPnL: 0,
        winRate: 0,
        tradesCount: 0,
        sharpeRatio: 0
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    strategies.push(newStrategy);
    
    res.status(201).json({
      success: true,
      data: newStrategy
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to create strategy',
      message: errorMessage
    });
  }
});

/**
 * PUT /strategies/:id
 * Update an existing strategy
 * @param {string} id - Strategy ID
 * @body {UpdateStrategyRequest} Strategy data to update
 * @returns {Strategy} Updated strategy object
 */
router.put('/:id', (req: Request<{ id: string }, {}, UpdateStrategyRequest>, res: Response) => {
  try {
    const { id } = req.params;
    const strategyIndex = strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
      return;
    }
    
    // Update strategy while maintaining the unified Strategy interface
    const updatedStrategy: Strategy = {
      ...strategies[strategyIndex],
      ...req.body,
      id, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString()
    };
    
    strategies[strategyIndex] = updatedStrategy;
    
    res.json({
      success: true,
      data: updatedStrategy
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to update strategy',
      message: errorMessage
    });
  }
});

/**
 * DELETE /strategies/:id
 * Delete a strategy
 * @param {string} id - Strategy ID
 * @returns {Object} Success confirmation
 */
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const strategyIndex = strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
      return;
    }
    
    strategies.splice(strategyIndex, 1);
    
    res.json({
      success: true,
      message: 'Strategy deleted successfully'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to delete strategy',
      message: errorMessage
    });
  }
});

/**
 * PATCH /strategies/:id/activate
 * Activate a strategy
 * @param {string} id - Strategy ID
 * @returns {Strategy} Updated strategy object
 */
router.patch('/:id/activate', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const strategyIndex = strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
      return;
    }
    
    strategies[strategyIndex].active = true;
    strategies[strategyIndex].updatedAt = new Date().toISOString();
    
    res.json({
      success: true,
      data: strategies[strategyIndex]
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to activate strategy',
      message: errorMessage
    });
  }
});

/**
 * PATCH /strategies/:id/deactivate
 * Deactivate a strategy
 * @param {string} id - Strategy ID
 * @returns {Strategy} Updated strategy object
 */
router.patch('/:id/deactivate', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const strategyIndex = strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
      return;
    }
    
    strategies[strategyIndex].active = false;
    strategies[strategyIndex].updatedAt = new Date().toISOString();
    
    res.json({
      success: true,
      data: strategies[strategyIndex]
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate strategy',
      message: errorMessage
    });
  }
});

export default router;
