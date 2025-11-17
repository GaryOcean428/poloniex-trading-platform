/**
 * Enhanced Autonomous Trading Agent
 *
 * Integrates AI strategy generation with autonomous trading:
 * - Generates strategies using Claude AI
 * - Creates multi-strategy combinations
 * - Manages strategy lifecycle (backtest → paper → live)
 * - Continuous learning and adaptation
 */
import { EventEmitter } from 'events';
import { pool } from '../db/connection.js';
import { getLLMStrategyGenerator } from './llmStrategyGenerator.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import automatedTradingService from './automatedTradingService.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import { logger } from '../utils/logger.js';
class EnhancedAutonomousAgent extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.runningIntervals = new Map();
        this.strategies = new Map();
    }
    /**
     * Start the enhanced autonomous agent
     */
    async startAgent(userId, config) {
        // Check if agent is already running
        const existingSession = Array.from(this.sessions.values()).find(s => s.userId === userId && s.status === 'running');
        if (existingSession) {
            throw new Error('Agent is already running for this user');
        }
        // Verify API credentials
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials) {
            throw new Error('No active API credentials found. Please add your Poloniex API keys.');
        }
        // Create default config
        const defaultConfig = {
            userId,
            maxDrawdown: 15,
            positionSize: 2,
            maxConcurrentPositions: 3,
            stopLossPercentage: 5,
            tradingStyle: 'day_trading',
            preferredPairs: ['BTC_USDT', 'ETH_USDT'],
            preferredTimeframes: ['15m', '1h', '4h'],
            automationLevel: 'fully_autonomous',
            strategyGenerationInterval: 24, // Generate new strategies daily
            backtestPeriodDays: 30,
            paperTradingDurationHours: 168, // 7 days
            enableAIStrategies: true,
            enableMultiStrategyCombo: true,
            ...config
        };
        // Create session
        const session = {
            id: `session_${Date.now()}_${userId}`,
            userId,
            status: 'running',
            startedAt: new Date(),
            strategiesGenerated: 0,
            backtestsCompleted: 0,
            paperTradesExecuted: 0,
            liveTradesExecuted: 0,
            totalPnl: 0,
            config: defaultConfig
        };
        this.sessions.set(session.id, session);
        // Store session in database
        await this.saveSession(session);
        // Start agent loop
        await this.startAgentLoop(session);
        logger.info(`Enhanced autonomous agent started for user ${userId}`, {
            sessionId: session.id,
            config: defaultConfig
        });
        this.emit('agent:started', { userId, sessionId: session.id });
        return session;
    }
    /**
     * Main agent loop
     */
    async startAgentLoop(session) {
        // Initial strategy generation
        if (session.config.enableAIStrategies) {
            await this.generateStrategies(session);
        }
        // Set up periodic strategy generation
        const interval = setInterval(async () => {
            try {
                if (session.status === 'running' && session.config.enableAIStrategies) {
                    await this.generateStrategies(session);
                }
            }
            catch (error) {
                logger.error('Error in agent loop:', error);
            }
        }, session.config.strategyGenerationInterval * 60 * 60 * 1000);
        this.runningIntervals.set(session.id, interval);
    }
    /**
     * Generate AI-powered trading strategies
     */
    async generateStrategies(session) {
        logger.info(`Generating strategies for session ${session.id}`);
        const strategies = [];
        const llmGenerator = getLLMStrategyGenerator();
        for (const symbol of session.config.preferredPairs) {
            try {
                // Generate single-indicator strategies
                const trendStrategy = await this.generateSingleStrategy(session, symbol, 'trend_following', ['SMA', 'EMA'], 'Trend following strategy using moving averages');
                const momentumStrategy = await this.generateSingleStrategy(session, symbol, 'momentum', ['RSI', 'MACD'], 'Momentum strategy using RSI and MACD');
                const volumeStrategy = await this.generateSingleStrategy(session, symbol, 'volume_analysis', ['Volume', 'OBV'], 'Volume analysis strategy');
                strategies.push(trendStrategy, momentumStrategy, volumeStrategy);
                // Generate multi-strategy combination if enabled
                if (session.config.enableMultiStrategyCombo) {
                    const comboStrategy = await this.createMultiStrategyCombo(session, symbol, [trendStrategy, momentumStrategy, volumeStrategy]);
                    strategies.push(comboStrategy);
                }
                // Update session stats
                session.strategiesGenerated += strategies.length;
                await this.saveSession(session);
            }
            catch (error) {
                logger.error(`Error generating strategies for ${symbol}:`, error);
            }
        }
        // Start strategy lifecycle for each strategy
        for (const strategy of strategies) {
            this.runStrategyLifecycle(session, strategy).catch(error => {
                logger.error(`Error in strategy lifecycle for ${strategy.name}:`, error);
            });
        }
        logger.info(`Generated ${strategies.length} strategies for session ${session.id}`);
        this.emit('strategies:generated', { sessionId: session.id, count: strategies.length });
        return strategies;
    }
    /**
     * Generate a single strategy
     */
    async generateSingleStrategy(session, symbol, strategyType, indicators, description) {
        const llmGenerator = getLLMStrategyGenerator();
        const aiStrategy = await llmGenerator.generateStrategy({
            symbol,
            timeframe: session.config.preferredTimeframes[0],
            strategyType,
            riskTolerance: 'moderate',
            indicators,
            description
        });
        const strategy = {
            id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sessionId: session.id,
            name: aiStrategy.name || `${strategyType}_${symbol}`,
            type: 'single',
            symbol,
            timeframe: session.config.preferredTimeframes[0],
            indicators,
            code: aiStrategy.code || JSON.stringify(aiStrategy),
            description,
            status: 'generated',
            performance: {
                winRate: 0,
                profitFactor: 0,
                totalTrades: 0,
                totalReturn: 0
            },
            createdAt: new Date()
        };
        this.strategies.set(strategy.id, strategy);
        await this.saveStrategy(strategy);
        return strategy;
    }
    /**
     * Create multi-strategy combination
     */
    async createMultiStrategyCombo(session, symbol, subStrategies) {
        const llmGenerator = getLLMStrategyGenerator();
        // Generate combination logic using AI
        const comboPrompt = `
Create a multi-strategy combination that combines these strategies:

1. Trend Strategy: ${subStrategies[0].description}
2. Momentum Strategy: ${subStrategies[1].description}
3. Volume Strategy: ${subStrategies[2].description}

The combination should:
- Use weighted voting (Trend: 40%, Momentum: 35%, Volume: 25%)
- Only enter trades when at least 2 strategies agree
- Exit when any strategy signals exit
- Include proper risk management with ${session.config.stopLossPercentage}% stop loss

Generate the combination logic as executable JavaScript code.
`;
        const aiCombo = await llmGenerator.generateStrategy({
            symbol,
            timeframe: session.config.preferredTimeframes[0],
            strategyType: 'multi_strategy_combo',
            riskTolerance: 'moderate',
            indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Volume', 'OBV'],
            description: `Multi-strategy combination for ${symbol}`,
            customPrompt: comboPrompt
        });
        const comboStrategy = {
            id: `combo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sessionId: session.id,
            name: `Multi-Combo: ${symbol}`,
            type: 'combo',
            symbol,
            timeframe: session.config.preferredTimeframes[0],
            indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Volume', 'OBV'],
            code: aiCombo.code || JSON.stringify(aiCombo),
            description: `Multi-strategy combination for ${symbol}`,
            status: 'generated',
            performance: {
                winRate: 0,
                profitFactor: 0,
                totalTrades: 0,
                totalReturn: 0
            },
            subStrategies: subStrategies.map((s, i) => ({
                strategyId: s.id,
                weight: [0.4, 0.35, 0.25][i]
            })),
            createdAt: new Date()
        };
        this.strategies.set(comboStrategy.id, comboStrategy);
        await this.saveStrategy(comboStrategy);
        return comboStrategy;
    }
    /**
     * Run strategy lifecycle: backtest → paper → live
     */
    async runStrategyLifecycle(session, strategy) {
        try {
            // 1. Backtest
            logger.info(`Starting backtest for strategy ${strategy.name}`);
            // Register strategy first
            backtestingEngine.registerStrategy(strategy.id, {
                id: strategy.id,
                name: strategy.name,
                type: 'custom',
                parameters: {},
                code: strategy.code
            });
            const backtestResult = await backtestingEngine.runBacktest(strategy.id, {
                symbol: strategy.symbol,
                startDate: new Date(Date.now() - session.config.backtestPeriodDays * 24 * 60 * 60 * 1000),
                endDate: new Date(),
                initialCapital: 10000
            });
            strategy.performance = {
                winRate: backtestResult.winRate || 0,
                profitFactor: backtestResult.profitFactor || 0,
                totalTrades: backtestResult.totalTrades || 0,
                totalReturn: backtestResult.totalReturn || 0
            };
            strategy.status = 'backtested';
            await this.saveStrategy(strategy);
            session.backtestsCompleted++;
            await this.saveSession(session);
            logger.info(`Backtest completed for ${strategy.name}:`, strategy.performance);
            this.emit('strategy:backtested', { strategyId: strategy.id, performance: strategy.performance });
            // 2. Promote to paper trading if backtest passes
            if (strategy.performance.winRate > 0.55 && strategy.performance.profitFactor > 1.5) {
                await this.promoteToPaperTrading(session, strategy);
            }
            else {
                logger.info(`Strategy ${strategy.name} failed backtest, retiring`);
                await this.retireStrategy(strategy, 'failed_backtest');
            }
        }
        catch (error) {
            logger.error(`Error in strategy lifecycle for ${strategy.name}:`, error);
            await this.retireStrategy(strategy, 'error');
        }
    }
    /**
     * Promote strategy to paper trading
     */
    async promoteToPaperTrading(session, strategy) {
        logger.info(`Promoting ${strategy.name} to paper trading`);
        strategy.status = 'paper_trading';
        strategy.promotedAt = new Date();
        await this.saveStrategy(strategy);
        // Start paper trading session
        await paperTradingService.startSession({
            userId: session.userId,
            strategyId: strategy.id,
            symbol: strategy.symbol,
            initialCapital: 10000,
            duration: session.config.paperTradingDurationHours * 60 * 60 * 1000
        });
        this.emit('strategy:paper_trading', { strategyId: strategy.id });
        // Schedule check for promotion to live trading
        setTimeout(async () => {
            await this.checkPaperTradingResults(session, strategy);
        }, session.config.paperTradingDurationHours * 60 * 60 * 1000);
    }
    /**
     * Check paper trading results and promote to live if successful
     */
    async checkPaperTradingResults(session, strategy) {
        try {
            const paperSession = paperTradingService.getSession(strategy.id);
            const paperResults = paperSession ? {
                winRate: paperSession.totalTrades > 0 ? (paperSession.winningTrades / paperSession.totalTrades) : 0,
                profitFactor: paperSession.losingTrades > 0 ?
                    Math.abs(paperSession.winningTrades / paperSession.losingTrades) : 0
            } : null;
            if (paperResults && paperResults.winRate > 0.60 && paperResults.profitFactor > 2.0) {
                await this.promoteToLiveTrading(session, strategy);
            }
            else {
                logger.info(`Strategy ${strategy.name} failed paper trading, retiring`);
                await this.retireStrategy(strategy, 'failed_paper_trading');
            }
        }
        catch (error) {
            logger.error(`Error checking paper trading results for ${strategy.name}:`, error);
        }
    }
    /**
     * Promote strategy to live trading
     */
    async promoteToLiveTrading(session, strategy) {
        logger.info(`Promoting ${strategy.name} to LIVE trading`);
        strategy.status = 'live';
        strategy.promotedAt = new Date();
        await this.saveStrategy(strategy);
        // Register strategy for live trading
        await automatedTradingService.registerStrategy(session.userId, {
            id: strategy.id,
            strategyId: strategy.id,
            symbol: strategy.symbol,
            positionSize: session.config.positionSize / 100,
            maxPositions: 1
        });
        this.emit('strategy:live', { strategyId: strategy.id });
    }
    /**
     * Retire a strategy
     */
    async retireStrategy(strategy, reason) {
        strategy.status = 'retired';
        strategy.retiredAt = new Date();
        await this.saveStrategy(strategy);
        logger.info(`Strategy ${strategy.name} retired: ${reason}`);
        this.emit('strategy:retired', { strategyId: strategy.id, reason });
    }
    /**
     * Stop the agent
     */
    async stopAgent(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        session.status = 'stopped';
        session.stoppedAt = new Date();
        await this.saveSession(session);
        // Clear interval
        const interval = this.runningIntervals.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.runningIntervals.delete(sessionId);
        }
        logger.info(`Agent stopped for session ${sessionId}`);
        this.emit('agent:stopped', { sessionId });
    }
    /**
     * Get agent status
     */
    async getAgentStatus(userId) {
        const session = Array.from(this.sessions.values()).find(s => s.userId === userId && s.status === 'running');
        return session || null;
    }
    /**
     * Get all strategies for a session
     */
    async getStrategies(sessionId) {
        return Array.from(this.strategies.values()).filter(s => s.sessionId === sessionId);
    }
    /**
     * Get all strategies for a user
     */
    async getUserStrategies(userId) {
        const userSessions = Array.from(this.sessions.values()).filter(s => s.userId === userId);
        const sessionIds = userSessions.map(s => s.id);
        return Array.from(this.strategies.values()).filter(s => sessionIds.includes(s.sessionId));
    }
    /**
     * Save session to database
     */
    async saveSession(session) {
        try {
            await pool.query(`INSERT INTO agent_sessions (id, user_id, status, started_at, stopped_at, strategies_generated, backtests_completed, paper_trades_executed, live_trades_executed, total_pnl, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           stopped_at = EXCLUDED.stopped_at,
           strategies_generated = EXCLUDED.strategies_generated,
           backtests_completed = EXCLUDED.backtests_completed,
           paper_trades_executed = EXCLUDED.paper_trades_executed,
           live_trades_executed = EXCLUDED.live_trades_executed,
           total_pnl = EXCLUDED.total_pnl,
           config = EXCLUDED.config`, [
                session.id,
                session.userId,
                session.status,
                session.startedAt,
                session.stoppedAt,
                session.strategiesGenerated,
                session.backtestsCompleted,
                session.paperTradesExecuted,
                session.liveTradesExecuted,
                session.totalPnl,
                JSON.stringify(session.config)
            ]);
        }
        catch (error) {
            logger.error('Error saving session:', error);
        }
    }
    /**
     * Save strategy to database
     */
    async saveStrategy(strategy) {
        try {
            await pool.query(`INSERT INTO agent_strategies (id, session_id, name, type, symbol, timeframe, indicators, code, description, status, performance, sub_strategies, created_at, promoted_at, retired_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           performance = EXCLUDED.performance,
           promoted_at = EXCLUDED.promoted_at,
           retired_at = EXCLUDED.retired_at`, [
                strategy.id,
                strategy.sessionId,
                strategy.name,
                strategy.type,
                strategy.symbol,
                strategy.timeframe,
                JSON.stringify(strategy.indicators),
                strategy.code,
                strategy.description,
                strategy.status,
                JSON.stringify(strategy.performance),
                JSON.stringify(strategy.subStrategies || []),
                strategy.createdAt,
                strategy.promotedAt,
                strategy.retiredAt
            ]);
        }
        catch (error) {
            logger.error('Error saving strategy:', error);
        }
    }
}
export const enhancedAutonomousAgent = new EnhancedAutonomousAgent();
export default enhancedAutonomousAgent;
