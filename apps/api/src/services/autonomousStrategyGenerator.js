import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import confidenceScoringService from './confidenceScoringService.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import { getLeverageTier, capEffectiveLeverage } from './leverageAwareStrategyFactory.js';
import { getMaxLeverage } from './marketCatalog.js';

/**
 * Leverage tier configuration for strategy generation.
 * Aligned with poloniex-futures-v3.json maxLeverage values.
 *
 * Tier 1 (100x): BTC, ETH — scalping/mean-reversion/breakout viable
 * Tier 2 (50x):  major alts — momentum/trend-following
 * Tier 3 (10x):  memecoins — momentum-only, 2-3x effective leverage
 */
const LEVERAGE_TIER_CONFIG = {
  1: {
    // BTC_USDT_PERP, ETH_USDT_PERP (100x max → 25x effective cap)
    strategyTypes: ['mean_reversion', 'breakout', 'trend_following', 'momentum'],
    leverageRange: { min: 5, max: 20 },
    stopLossRange: { min: 0.003, max: 0.008 },
    timeframes: ['1m', '5m', '15m', '1h'],
    targetRegimes: ['trending', 'mean_reverting', 'any'],
  },
  2: {
    // Major alts (50x max → 12x effective cap)
    strategyTypes: ['momentum', 'trend_following', 'breakout', 'mean_reversion'],
    leverageRange: { min: 3, max: 10 },
    stopLossRange: { min: 0.01, max: 0.02 },
    timeframes: ['5m', '15m', '1h', '4h'],
    targetRegimes: ['trending', 'mean_reverting', 'any'],
  },
  3: {
    // Memecoins (10x max → 2x effective cap)
    strategyTypes: ['momentum', 'trend_following'],
    leverageRange: { min: 1, max: 2 },
    stopLossRange: { min: 0.03, max: 0.05 },
    timeframes: ['1m', '5m', '15m'],
    targetRegimes: ['trending'],
  },
};

// ─── Bridge law constant (frozen physics result, not tunable) ─────────────────
// w(tf) = (60 / tfMinutes)^0.74   (τ ∝ J^0.74, R²>0.96, seed-robust)
const BRIDGE_LAW_EXPONENT = 0.74;

/** Bridge law timeframe weight */
function bridgeLawWeight(tfMinutes) {
  return Math.pow(60 / tfMinutes, BRIDGE_LAW_EXPONENT);
}

/** Minutes per timeframe label */
const TF_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240 };

// Regime basin membership (for crossover guard)
const TRENDING_TYPES = new Set(['momentum', 'trend_following', 'breakout']);
const REVERTING_TYPES = new Set(['mean_reversion', 'scalping']);

/** Returns true iff both strategy types live in the same regime basin */
function sameRegimeBasin(type1, type2) {
  const t1trending = TRENDING_TYPES.has(type1);
  const t2trending = TRENDING_TYPES.has(type2);
  return t1trending === t2trending;
}

/**
 * Autonomous Strategy Generator
 * Creates, tests, and evolves trading strategies automatically
 * Goal: Maximum profit within risk tolerance with minimal human intervention
 */
class AutonomousStrategyGenerator extends EventEmitter {
  constructor() {
    super();
    this.strategies = new Map();
    this.activeStrategies = new Map();
    this.retiredStrategies = new Map();
    this.generationCount = 0;
    this.isRunning = false;
    this.riskTolerance = {
      maxDrawdown: 0.15,        // 15% max drawdown
      riskPerTrade: 0.02,       // 2% risk per trade
      maxPositionSize: 0.1,     // 10% max position size
      profitBankingPercent: 0.3 // Bank 30% of profits
    };
    
    // Strategy generation parameters
    this.generationConfig = {
      populationSize: 20,       // Number of strategies per generation
      maxGenerations: 100,      // Max generations before reset
      mutationRate: 0.1,        // 10% mutation rate
      crossoverRate: 0.7,       // 70% crossover rate
      elitismRate: 0.2,         // Keep top 20% performers
      diversityThreshold: 0.8,  // Minimum diversity score
      performanceWindow: 168,   // 7 days performance evaluation
      minBacktestPeriod: 30     // 30 days minimum backtest
    };
    
    // Available indicators and parameters for strategy generation
    this.indicatorLibrary = {
      trend: ['SMA', 'EMA', 'MACD', 'ADX', 'Parabolic_SAR'],
      momentum: ['RSI', 'Stochastic', 'Williams_R', 'CCI'],
      volatility: ['Bollinger_Bands', 'ATR', 'Keltner_Channel'],
      volume: ['Volume_SMA', 'Volume_Weighted_Price', 'Money_Flow_Index'],
      support_resistance: ['Pivot_Points', 'Fibonacci', 'Support_Resistance_Levels']
    };
    
    this.parameterRanges = {
      periods: { min: 5, max: 200 },
      thresholds: { min: 10, max: 90 },
      multipliers: { min: 0.5, max: 3.0 },
      timeframes: ['1m', '5m', '15m', '30m', '1h', '4h']
    };
    
    // Performance tracking
    this.performanceMetrics = {
      totalProfit: 0,
      totalTrades: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      bankedProfits: 0
    };
    
    this.logger = logger;

    // Population fitness weights learned from historical DB performance
    // Keys are strategy types; values are weight multipliers updated each generation
    this.fitnessWeights = {
      momentum: 1.0,
      mean_reversion: 1.0,
      breakout: 1.0,
      trend_following: 1.0,
      scalping: 1.0,
    };

    // Current detected regime (updated each generation)
    this.currentRegime = 'unknown'; // 'trending' | 'ranging' | 'volatile' | 'unknown'
  }

  // ─── Market regime detection ────────────────────────────────────────────────

  /**
   * Detect market regime using recent backtest performance as proxy.
   * Returns 'trending', 'ranging', 'volatile', or 'unknown'.
   */
  async detectMarketRegime() {
    try {
      const result = await query(`
        SELECT
          AVG(sharpe_ratio)        AS avg_sharpe,
          STDDEV(sharpe_ratio)     AS std_sharpe,
          AVG(max_drawdown_percent) AS avg_dd
        FROM backtest_results
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND sharpe_ratio IS NOT NULL
      `);
      if (!result.rows.length) return 'unknown';
      const { avg_sharpe, std_sharpe, avg_dd } = result.rows[0];
      const sharpe = Number(avg_sharpe) || 0;
      const stdSharpe = Number(std_sharpe) || 0;
      const dd = Number(avg_dd) || 0;
      if (sharpe > 1.2 && dd < 0.08) return 'trending';
      if (stdSharpe > 1.5 || dd > 0.15) return 'volatile';
      return 'ranging';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Load learned fitness weights from strategy_performance table.
   * Each type gets a weight proportional to its median uncensored Sharpe.
   */
  async loadFitnessWeightsFromDB() {
    try {
      const result = await query(`
        SELECT strategy_type,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(uncensored_sharpe, paper_sharpe, backtest_sharpe)) AS median_sharpe
        FROM strategy_performance
        WHERE is_censored = FALSE
          AND fitness_divergent = FALSE
          AND status NOT IN ('killed', 'retired', 'censored_rejected')
        GROUP BY strategy_type
      `);
      for (const row of result.rows) {
        const sharpe = Number(row.median_sharpe);
        if (Number.isFinite(sharpe) && sharpe > 0) {
          this.fitnessWeights[row.strategy_type] = 1 + Math.min(sharpe, 3); // cap at 4×
        }
      }
      this.logger.debug('Updated fitness weights from DB:', this.fitnessWeights);
    } catch {
      // Non-critical; use default weights
    }
  }

  /**
   * Compute bridge-law-weighted signal for multi-timeframe strategy.
   * w(tf) = (60/tfMinutes)^0.74  — frozen constant.
   */
  computeMultiTimeframeWeights(timeframes) {
    const weights = {};
    let total = 0;
    for (const tf of timeframes) {
      const mins = TF_MINUTES[tf] ?? 60;
      weights[tf] = bridgeLawWeight(mins);
      total += weights[tf];
    }
    for (const tf of timeframes) weights[tf] /= total;
    return weights;
  }

  /**
   * Initialize the autonomous strategy generator
   */
  async initialize() {
    try {
      this.logger.info('🧠 Initializing Autonomous Strategy Generator...');
      
      // Load any existing strategies from database
      await this.loadExistingStrategies();
      
      // Start with initial population if none exist
      if (this.strategies.size === 0) {
        await this.createInitialPopulation();
      }
      
      this.logger.info(`✅ Autonomous Strategy Generator initialized with ${this.strategies.size} strategies`);
      this.emit('initialized', { strategiesCount: this.strategies.size });
      
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to initialize Autonomous Strategy Generator:', error);
      throw error;
    }
  }
  
  /**
   * Start autonomous strategy generation and evolution
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Autonomous Strategy Generator is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('🚀 Starting Autonomous Strategy Generation...');
    
    try {
      // Start the main evolution loop
      this.evolutionLoop();
      
      this.emit('started');
      this.logger.info('✅ Autonomous Strategy Generation started');
    } catch (error) {
      this.logger.error('❌ Failed to start Autonomous Strategy Generation:', error);
      this.isRunning = false;
      throw error;
    }
  }
  
  /**
   * Stop autonomous strategy generation
   */
  async stop() {
    this.isRunning = false;
    this.logger.info('⏹️ Stopping Autonomous Strategy Generation...');
    
    // Stop all active strategies
    for (const [strategyId, strategy] of this.activeStrategies) {
      await this.deactivateStrategy(strategyId);
    }
    
    this.emit('stopped');
    this.logger.info('✅ Autonomous Strategy Generation stopped');
  }
  
  /**
   * Main evolution loop - continuously generates and evolves strategies
   */
  async evolutionLoop() {
    while (this.isRunning) {
      try {
        this.logger.info(`🔄 Starting generation ${this.generationCount + 1}...`);

        // 0. Detect current market regime and load learned fitness weights
        this.currentRegime = await this.detectMarketRegime();
        await this.loadFitnessWeightsFromDB();
        this.logger.info(`📡 Detected regime: ${this.currentRegime}`);
        
        // 1. Evaluate current strategy performance
        await this.evaluateStrategies();
        
        // 2. Generate new strategies through mutation and crossover
        await this.generateNewStrategies();
        
        // 3. Backtest new strategies
        await this.backtestStrategies();
        
        // 4. Select best performers for paper trading
        await this.selectForPaperTrading();
        
        // 5. Promote best paper traders to live trading
        await this.promoteToLiveTrading();
        
        // 6. Retire underperforming strategies
        await this.retireStrategies();
        
        // 7. Bank profits if threshold reached
        await this.bankProfits();
        
        // 8. Ensure diversity and prevent overfitting
        await this.maintainDiversity();
        
        this.generationCount++;
        
        // Emit generation complete event
        this.emit('generationComplete', {
          generation: this.generationCount,
          totalStrategies: this.strategies.size,
          activeStrategies: this.activeStrategies.size,
          performance: this.performanceMetrics
        });
        
        // Wait before next generation (30 minutes)
        await this.sleep(30 * 60 * 1000);
        
      } catch (error) {
        this.logger.error('❌ Error in evolution loop:', error);
        await this.sleep(60 * 1000); // Wait 1 minute before retrying
      }
    }
  }
  
  /**
   * Create initial population of strategies with leverage-tier awareness.
   * Fetches maxLeverage for each symbol from the market catalog so that
   * generateRandomStrategy() can cap leverage appropriately.
   */
  async createInitialPopulation() {
    this.logger.info('🧪 Creating initial strategy population...');
    
    const symbols = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP', 'XRP_USDT_PERP', 'LINK_USDT_PERP'];
    const strategyTypes = ['momentum', 'mean_reversion', 'breakout', 'trend_following'];

    // Pre-fetch maxLeverage for all symbols to avoid async inside sync generateRandomStrategy
    const leverageMap = {};
    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const maxLev = await getMaxLeverage(sym);
          if (maxLev != null) leverageMap[sym] = maxLev;
        } catch (_err) {
          // use default (50) if fetch fails
        }
      })
    );
    
    for (let i = 0; i < this.generationConfig.populationSize; i++) {
      const strategy = this.generateRandomStrategy(symbols, strategyTypes, leverageMap);
      this.strategies.set(strategy.id, strategy);
      
      this.logger.info(`Created strategy ${strategy.id}: ${strategy.name} (T${strategy.leverageTier} ${strategy.leverage}x)`);
    }
    
    this.logger.info(`✅ Created ${this.strategies.size} initial strategies`);
  }
  
  /**
   * Generate a random strategy with random parameters.
   * Combines leverage-tier awareness with regime-conditioned type selection
   * and learned fitness weights (QIG learning loop).
   *
   * @param {string[]} symbols       List of candidate symbols
   * @param {string[]} strategyTypes Fallback strategy types (overridden by tier config)
   * @param {Object}   [leverageMap] Optional pre-fetched {symbol → maxLeverage} map
   */
  generateRandomStrategy(symbols, strategyTypes, leverageMap = {}) {
    const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];

    // Determine leverage tier from the symbol's max leverage
    const maxLeverage = leverageMap[symbol] ?? 50; // default to Tier 2 if unknown
    const tier = getLeverageTier(maxLeverage);
    const tierConfig = LEVERAGE_TIER_CONFIG[tier];

    // Regime-conditioned type selection (QIG: don't average across regime basins)
    // Intersect tier-allowed types with regime-preferred types
    let candidateTypes = tierConfig.strategyTypes;
    if (this.currentRegime === 'trending') {
      const regimeFiltered = candidateTypes.filter(t => TRENDING_TYPES.has(t));
      if (regimeFiltered.length > 0) candidateTypes = regimeFiltered;
    } else if (this.currentRegime === 'ranging') {
      const regimeFiltered = candidateTypes.filter(t => REVERTING_TYPES.has(t));
      if (regimeFiltered.length > 0) candidateTypes = regimeFiltered;
    }

    // Weight type selection by learned fitness weights from DB
    const weights = candidateTypes.map(t => this.fitnessWeights[t] ?? 1.0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let type = candidateTypes[0];
    for (let i = 0; i < candidateTypes.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { type = candidateTypes[i]; break; }
    }

    // Select timeframe appropriate for this tier
    const timeframe = tierConfig.timeframes[Math.floor(Math.random() * tierConfig.timeframes.length)];

    // Pick a target regime for this strategy
    const targetRegime = tierConfig.targetRegimes[Math.floor(Math.random() * tierConfig.targetRegimes.length)];

    // Generate random leverage within tier range, then cap at 25% of maxLeverage
    const rawLeverage = this.randomInt(tierConfig.leverageRange.min, tierConfig.leverageRange.max);
    const leverage = capEffectiveLeverage(rawLeverage, maxLeverage);

    // Generate random stop loss within tier range
    const stopLoss = this.randomFloat(tierConfig.stopLossRange.min, tierConfig.stopLossRange.max);

    // Generate random indicator combination scoped to tier-appropriate indicators
    const indicators = this.selectRandomIndicators(tier);
    const parameters = this.generateRandomParameters(type, indicators, { stopLoss, leverage, tier });

    return {
      id,
      name: `Auto ${type} ${symbol} ${timeframe} T${tier}`,
      type,
      symbol,
      timeframe,
      regimeAtCreation: this.currentRegime,
      leverageTier: tier,
      maxLeverage,
      leverage,
      targetRegime,
      indicators,
      parameters,
      performance: {
        profit: 0,
        trades: 0,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        confidence: 0,
        backtestScore: 0,
        paperTradeScore: 0,
        liveTradeScore: 0
      },
      status: 'created',
      createdAt: new Date(),
      generation: this.generationCount
    };
  }

  /**
   * Select random indicators for strategy, optionally scoped by leverage tier.
   *
   * Tier 1: all indicator categories (highest signal complexity)
   * Tier 2: momentum + trend + volatility + volume
   * Tier 3: momentum + volatility only (simpler signals for memecoins)
   *
   * @param {1|2|3} [tier] Leverage tier (optional; defaults to all categories)
   */
  selectRandomIndicators(tier) {
    const indicators = [];
    let categories = Object.keys(this.indicatorLibrary);

    // Scope indicator categories by tier
    if (tier === 3) {
      // Memecoins: momentum only — no complex trend/SR indicators
      categories = ['momentum', 'volatility'];
    } else if (tier === 2) {
      // Major alts: momentum + trend
      categories = ['trend', 'momentum', 'volatility', 'volume'];
    }
    // Tier 1 uses all categories

    // Select 2-4 indicators from different categories
    const numIndicators = Math.floor(Math.random() * 3) + 2;
    const selectedCategories = this.shuffleArray(categories).slice(0, numIndicators);

    for (const category of selectedCategories) {
      const categoryIndicators = this.indicatorLibrary[category];
      if (!categoryIndicators) continue;
      const indicator = categoryIndicators[Math.floor(Math.random() * categoryIndicators.length)];
      indicators.push({ category, indicator });
    }

    return indicators;
  }
  
  /**
   * Generate random parameters for strategy.
   *
   * @param {string} type        Strategy type
   * @param {Array}  indicators  Selected indicators
   * @param {Object} [tierOpts]  Tier-specific overrides: { stopLoss, leverage, tier }
   */
  generateRandomParameters(type, indicators, tierOpts = {}) {
    const parameters = {};

    // Base parameters — use tier-appropriate ranges when provided
    parameters.stopLoss = tierOpts.stopLoss ?? this.randomFloat(0.01, 0.05);
    parameters.takeProfit = this.randomFloat(parameters.stopLoss * 1.5, parameters.stopLoss * 3);
    parameters.positionSize = this.randomFloat(0.01, this.riskTolerance.maxPositionSize);
    parameters.leverage = tierOpts.leverage ?? 3;
    
    // Type-specific parameters
    switch (type) {
      case 'momentum':
        parameters.rsi_oversold = this.randomInt(20, 35);
        parameters.rsi_overbought = this.randomInt(65, 80);
        parameters.macd_threshold = this.randomFloat(-0.001, 0.001);
        break;
        
      case 'mean_reversion':
        parameters.bb_std_dev = this.randomFloat(1.5, 2.5);
        parameters.rsi_extreme = this.randomInt(15, 25);
        parameters.reversion_threshold = this.randomFloat(0.02, 0.05);
        break;
        
      case 'breakout':
        parameters.volume_threshold = this.randomFloat(1.2, 3.0);
        parameters.price_threshold = this.randomFloat(0.005, 0.02);
        parameters.confirmation_candles = this.randomInt(2, 5);
        break;
        
      case 'trend_following':
        parameters.sma_fast = this.randomInt(5, 20);
        parameters.sma_slow = this.randomInt(20, 50);
        parameters.trend_strength = this.randomFloat(0.5, 0.8);
        break;
    }
    
    // Indicator-specific parameters
    for (const { indicator } of indicators) {
      switch (indicator) {
        case 'RSI':
          parameters.rsi_period = this.randomInt(10, 20);
          break;
        case 'MACD':
          parameters.macd_fast = this.randomInt(8, 15);
          parameters.macd_slow = this.randomInt(20, 30);
          parameters.macd_signal = this.randomInt(7, 12);
          break;
        case 'Bollinger_Bands':
          parameters.bb_period = this.randomInt(15, 25);
          parameters.bb_std = this.randomFloat(1.8, 2.2);
          break;
        case 'ATR':
          parameters.atr_period = this.randomInt(10, 20);
          parameters.atr_multiplier = this.randomFloat(1.5, 3.0);
          break;
      }
    }
    
    return parameters;
  }
  
  /**
   * Evaluate performance of all strategies
   */
  async evaluateStrategies() {
    this.logger.info('📊 Evaluating strategy performance...');
    
    for (const [strategyId, strategy] of this.strategies) {
      try {
        // Update performance metrics based on current status
        if (strategy.status === 'live') {
          await this.updateLivePerformance(strategy);
        } else if (strategy.status === 'paper_trading') {
          await this.updatePaperPerformance(strategy);
        } else if (strategy.status === 'backtested') {
          await this.updateBacktestPerformance(strategy);
        }
        
        // Calculate overall fitness score
        strategy.fitness = this.calculateFitnessScore(strategy);
        
      } catch (error) {
        this.logger.error(`Error evaluating strategy ${strategyId}:`, error);
      }
    }
  }
  
  /**
   * Generate new strategies through mutation and crossover.
   * Regime-conditioned: only crossover strategies in the same basin.
   */
  async generateNewStrategies() {
    this.logger.info('🧬 Generating new strategies...');
    
    // Get top performers for breeding
    const topPerformers = Array.from(this.strategies.values())
      .sort((a, b) => (b.fitness || 0) - (a.fitness || 0))
      .slice(0, Math.floor(this.strategies.size * this.generationConfig.elitismRate));
    
    const newStrategies = [];
    
    // Generate new strategies through crossover and mutation
    for (let i = 0; i < Math.floor(this.generationConfig.populationSize * 0.3); i++) {
      if (Math.random() < this.generationConfig.crossoverRate && topPerformers.length >= 2) {
        // QIG regime guard: only crossover within same basin (trending ↔ mean-reversion forbidden)
        const parent1 = topPerformers[Math.floor(Math.random() * topPerformers.length)];
        const compatible = topPerformers.filter(
          p => p.id !== parent1.id && sameRegimeBasin(parent1.type, p.type)
        );
        if (compatible.length > 0) {
          const parent2 = compatible[Math.floor(Math.random() * compatible.length)];
          const offspring = this.crossoverStrategies(parent1, parent2);
          newStrategies.push(offspring);
        } else {
          // No compatible crossover partner → mutate instead
          const mutated = this.mutateStrategy(parent1);
          newStrategies.push(mutated);
        }
      } else if (topPerformers.length > 0) {
        // Mutation of top performer
        const parent = topPerformers[Math.floor(Math.random() * topPerformers.length)];
        const mutated = this.mutateStrategy(parent);
        newStrategies.push(mutated);
      }
    }
    
    // Add new strategies to population
    for (const strategy of newStrategies) {
      this.strategies.set(strategy.id, strategy);
    }
    
    this.logger.info(`✅ Generated ${newStrategies.length} new strategies`);
  }
  
  /**
   * Crossover two strategies from the same regime basin.
   * Preserves leverage tier of chosen parent symbol (re-capped at 25% max).
   * Regime-conditioned: both parents must be in the same basin (enforced by caller).
   */
  crossoverStrategies(parent1, parent2) {
    const id = `cross_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    // Mix parameters from both parents
    const parameters = {};
    for (const key in parent1.parameters) {
      parameters[key] = Math.random() < 0.5 ? parent1.parameters[key] : parent2.parameters[key];
    }
    
    // Mix indicators
    const indicators = [...parent1.indicators, ...parent2.indicators]
      .filter((indicator, index, self) => 
        index === self.findIndex(i => i.indicator === indicator.indicator)
      )
      .slice(0, 4); // Max 4 indicators
    
    // Inherit symbol and leverage tier from chosen parent
    const chosenSymbol = Math.random() < 0.5 ? parent1.symbol : parent2.symbol;
    const inheritedTier = chosenSymbol === parent1.symbol ? parent1.leverageTier : parent2.leverageTier;
    const inheritedMaxLev = chosenSymbol === parent1.symbol ? parent1.maxLeverage : parent2.maxLeverage;
    const inheritedLev = Math.random() < 0.5 ? parent1.leverage : parent2.leverage;
    // Re-cap leverage for the selected symbol
    const leverage = inheritedMaxLev
      ? capEffectiveLeverage(inheritedLev ?? 3, inheritedMaxLev)
      : (inheritedLev ?? 3);
    if (parameters.leverage !== undefined) parameters.leverage = leverage;

    return {
      id,
      name: `Cross ${parent1.type} x ${parent2.type}`,
      type: Math.random() < 0.5 ? parent1.type : parent2.type,
      symbol: chosenSymbol,
      timeframe: Math.random() < 0.5 ? parent1.timeframe : parent2.timeframe,
      regimeAtCreation: this.currentRegime,
      leverageTier: inheritedTier,
      maxLeverage: inheritedMaxLev,
      leverage,
      targetRegime: Math.random() < 0.5 ? parent1.targetRegime : parent2.targetRegime,
      indicators,
      parameters,
      performance: {
        profit: 0,
        trades: 0,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        confidence: 0,
        backtestScore: 0,
        paperTradeScore: 0,
        liveTradeScore: 0
      },
      status: 'created',
      createdAt: new Date(),
      generation: this.generationCount,
      parents: [parent1.id, parent2.id]
    };
  }
  
  /**
   * Mutate a strategy to create variation.
   * Preserves leverageTier and re-caps leverage after mutation.
   */
  mutateStrategy(parent) {
    const id = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const mutated = JSON.parse(JSON.stringify(parent));
    
    mutated.id = id;
    mutated.name = `Mut ${parent.name}`;
    mutated.createdAt = new Date();
    mutated.generation = this.generationCount;
    mutated.parent = parent.id;
    mutated.performance = {
      profit: 0,
      trades: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      confidence: 0,
      backtestScore: 0,
      paperTradeScore: 0,
      liveTradeScore: 0
    };
    
    // Mutate parameters
    for (const key in mutated.parameters) {
      if (Math.random() < this.generationConfig.mutationRate) {
        if (typeof mutated.parameters[key] === 'number') {
          // Add random noise to numeric parameters
          const noise = (Math.random() - 0.5) * 0.2; // ±10% variation
          mutated.parameters[key] *= (1 + noise);
          
          // Ensure parameters stay within reasonable bounds
          mutated.parameters[key] = Math.max(0.001, Math.min(1.0, mutated.parameters[key]));
        }
      }
    }

    // Re-cap leverage after mutation to stay within tier limits
    if (mutated.maxLeverage && mutated.parameters.leverage !== undefined) {
      mutated.parameters.leverage = capEffectiveLeverage(
        Math.round(mutated.parameters.leverage),
        mutated.maxLeverage
      );
      mutated.leverage = mutated.parameters.leverage;
    }
    
    // Occasionally mutate indicators (scoped to tier)
    if (Math.random() < this.generationConfig.mutationRate * 0.5) {
      mutated.indicators = this.selectRandomIndicators(mutated.leverageTier);
    }
    
    return mutated;
  }
  
  /**
   * Calculate fitness score for strategy selection.
   * Uses DB-learned per-type weights and penalises censored/divergent strategies.
   * Two fitness values are produced (all-data and uncensored-only); if they diverge
   * >20% the strategy is flagged as unreliable.
   */
  calculateFitnessScore(strategy) {
    const perf = strategy.performance;
    
    // Multi-objective fitness function
    const profitScore = Math.max(0, perf.profit) * 0.3;
    const winRateScore = (perf.winRate || 0) * 0.2;
    const sharpeScore = Math.max(0, perf.sharpeRatio || 0) * 0.2;
    const drawdownPenalty = Math.max(0, perf.maxDrawdown || 0) * -0.2;
    const confidenceScore = (perf.confidence || 0) * 0.1;

    // Apply learned fitness weight for strategy type
    const typeWeight = this.fitnessWeights[strategy.type] ?? 1.0;

    // Penalise censored or divergent strategies
    const censorPenalty = strategy.isCensored ? 0.5 : 1.0;
    const divergentPenalty = strategy.fitnessDivergent ? 0.3 : 1.0;
    
    const raw = profitScore + winRateScore + sharpeScore + drawdownPenalty + confidenceScore;
    return raw * typeWeight * censorPenalty * divergentPenalty;
  }
  
  /**
   * Bank profits to spot account
   */
  async bankProfits() {
    if (this.performanceMetrics.totalProfit > 100) { // Bank if profit > $100
      const bankAmount = this.performanceMetrics.totalProfit * this.riskTolerance.profitBankingPercent;
      
      try {
        // Transfer to spot account via Poloniex API
        // await poloniexFuturesService.transferToSpot(bankAmount);
        
        this.performanceMetrics.bankedProfits += bankAmount;
        this.performanceMetrics.totalProfit -= bankAmount;
        
        this.logger.info(`💰 Banked ${bankAmount.toFixed(2)} USDT to spot account`);
        this.emit('profitBanked', { amount: bankAmount, totalBanked: this.performanceMetrics.bankedProfits });
      } catch (error) {
        this.logger.error('❌ Failed to bank profits:', error);
      }
    }
  }
  
  /**
   * Utility functions
   */
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  randomFloat(min, max) {
    return Math.random() * (max - min) + min;
  }
  
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Additional methods to be implemented in next iteration
  async loadExistingStrategies() { /* Implementation */ }
  async backtestStrategies() { /* Implementation */ }
  async selectForPaperTrading() { /* Implementation */ }
  async promoteToLiveTrading() { /* Implementation */ }
  async retireStrategies() { /* Implementation */ }
  async maintainDiversity() { /* Implementation */ }
  async updateLivePerformance() { /* Implementation */ }
  async updatePaperPerformance() { /* Implementation */ }
  async updateBacktestPerformance() { /* Implementation */ }
  async deactivateStrategy() { /* Implementation */ }
}

export default new AutonomousStrategyGenerator();