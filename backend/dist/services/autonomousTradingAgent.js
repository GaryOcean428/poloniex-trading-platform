import { EventEmitter } from 'events';
import { pool } from '../db/connection.js';
import { getLLMStrategyGenerator } from './llmStrategyGenerator.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import automatedTradingService from './automatedTradingService.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import mlPredictionService from './mlPredictionService.js';
import { logger } from '../utils/logger.js';
class AutonomousTradingAgent extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.runningIntervals = new Map();
    }
    /**
     * Start the autonomous trading agent for a user
     */
    async startAgent(userId, config) {
        // Check if agent is already running
        const existingSession = Array.from(this.sessions.values()).find(s => s.userId === userId && s.status === 'running');
        if (existingSession) {
            throw new Error('Agent is already running for this user');
        }
        // Get user's API credentials
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
            preferredPairs: ['BTCUSDTPERP', 'ETHUSDTPERP'], // Futures symbols for Poloniex
            preferredTimeframes: ['15m', '1h', '4h'],
            automationLevel: 'fully_autonomous',
            strategyGenerationInterval: 24, // Generate new strategies every 24 hours
            backtestPeriodDays: 365,
            paperTradingDurationHours: 48,
            ...config
        };
        // Create session in database
        const result = await pool.query(`INSERT INTO agent_sessions (user_id, status, started_at, config)
       VALUES ($1, $2, NOW(), $3)
       RETURNING *`, [userId, 'running', JSON.stringify(defaultConfig)]);
        const session = {
            id: result.rows[0].id,
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
        // Start the autonomous loop
        this.startAutonomousLoop(session);
        // Log activity
        await this.logActivity(session.id, 'agent_started', 'Autonomous trading agent started');
        this.emit('agent_started', session);
        return session;
    }
    /**
     * Stop the autonomous trading agent
     */
    async stopAgent(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        // Stop the autonomous loop
        const interval = this.runningIntervals.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.runningIntervals.delete(sessionId);
        }
        // Update session status
        session.status = 'stopped';
        session.stoppedAt = new Date();
        await pool.query(`UPDATE agent_sessions SET status = $1, stopped_at = NOW() WHERE id = $2`, ['stopped', sessionId]);
        await this.logActivity(sessionId, 'agent_stopped', 'Autonomous trading agent stopped');
        this.emit('agent_stopped', session);
    }
    /**
     * Pause the autonomous trading agent
     */
    async pauseAgent(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        const interval = this.runningIntervals.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.runningIntervals.delete(sessionId);
        }
        session.status = 'paused';
        await pool.query(`UPDATE agent_sessions SET status = $1 WHERE id = $2`, ['paused', sessionId]);
        await this.logActivity(sessionId, 'agent_paused', 'Autonomous trading agent paused');
        this.emit('agent_paused', session);
    }
    /**
     * Get agent status
     */
    async getAgentStatus(userId) {
        const session = Array.from(this.sessions.values()).find(s => s.userId === userId && (s.status === 'running' || s.status === 'paused'));
        if (!session) {
            // Check database for persisted session
            const result = await pool.query(`SELECT * FROM agent_sessions 
         WHERE user_id = $1 AND status IN ('running', 'paused')
         ORDER BY started_at DESC LIMIT 1`, [userId]);
            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    id: row.id,
                    userId: row.user_id,
                    status: row.status,
                    startedAt: row.started_at,
                    stoppedAt: row.stopped_at,
                    strategiesGenerated: row.strategies_generated,
                    backtestsCompleted: row.backtests_completed,
                    paperTradesExecuted: row.paper_trades_executed,
                    liveTradesExecuted: row.live_trades_executed,
                    totalPnl: parseFloat(row.total_pnl || 0),
                    config: row.config
                };
            }
            return null;
        }
        return session;
    }
    /**
     * Main autonomous trading loop
     */
    async startAutonomousLoop(session) {
        console.log(`[Agent ${session.id}] Starting autonomous loop`);
        // Run immediately on start
        this.runAutonomousCycle(session).catch(err => {
            console.error(`[Agent ${session.id}] Error in autonomous cycle:`, err);
            this.emit('agent_error', { session, error: err });
        });
        // Then run periodically
        const intervalMs = session.config.strategyGenerationInterval * 60 * 60 * 1000;
        const interval = setInterval(async () => {
            try {
                await this.runAutonomousCycle(session);
            }
            catch (err) {
                console.error(`[Agent ${session.id}] Error in autonomous cycle:`, err);
                this.emit('agent_error', { session, error: err });
            }
        }, intervalMs);
        this.runningIntervals.set(session.id, interval);
    }
    /**
     * Run one complete autonomous trading cycle
     */
    async runAutonomousCycle(session) {
        console.log(`[Agent ${session.id}] Running autonomous cycle`);
        try {
            // Step 1: Generate strategies using Claude AI
            const strategies = await this.generateStrategies(session);
            console.log(`[Agent ${session.id}] Generated ${strategies.length} strategies`);
            // Step 2: Backtest all strategies in parallel
            const backtestResults = await this.backtestStrategies(session, strategies);
            console.log(`[Agent ${session.id}] Completed ${backtestResults.length} backtests`);
            // Step 3: Select top performing strategies
            const topStrategies = this.selectTopStrategies(backtestResults, 3);
            console.log(`[Agent ${session.id}] Selected ${topStrategies.length} top strategies`);
            // Step 4: Start paper trading for top strategies
            if (topStrategies.length > 0) {
                await this.startPaperTrading(session, topStrategies);
                console.log(`[Agent ${session.id}] Started paper trading for top strategies`);
            }
            // Step 5: Evaluate paper trading results and promote to live if successful
            await this.evaluatePaperTradingResults(session);
            // Step 6: Learn from results and adapt
            await this.learnAndAdapt(session);
        }
        catch (err) {
            console.error(`[Agent ${session.id}] Error in autonomous cycle:`, err);
            await this.logActivity(session.id, 'cycle_error', `Error: ${err.message}`);
            throw err;
        }
    }
    /**
     * Generate trading strategies using Claude AI
     */
    async generateStrategies(session) {
        const { config } = session;
        const strategies = [];
        // Get market context for strategy generation
        const marketContext = await this.getMarketContext(config.preferredPairs[0]);
        // Get ML predictions for enhanced strategy generation
        let mlPredictions = null;
        try {
            const poloniexService = (await import('./poloniexFuturesService.js')).default;
            const ohlcvData = await poloniexService.getHistoricalData(config.preferredPairs[0], '1h', 200);
            mlPredictions = await mlPredictionService.getMultiHorizonPredictions(config.preferredPairs[0], ohlcvData);
            console.log(`[Agent ${session.id}] ML predictions obtained:`, mlPredictions);
        }
        catch (mlError) {
            console.warn(`[Agent ${session.id}] ML predictions unavailable:`, mlError.message);
        }
        // Generate 5-10 strategy variations
        const numStrategies = 5;
        for (let i = 0; i < numStrategies; i++) {
            try {
                const prompt = this.buildStrategyGenerationPrompt(config, marketContext, i);
                const llmStrategyGenerator = getLLMStrategyGenerator();
                // Build market context for LLM with ML predictions
                const llmMarketContext = {
                    symbol: config.preferredPairs[0],
                    currentPrice: marketContext.price || 0,
                    priceChange24h: 0,
                    volume24h: 0,
                    technicalIndicators: {},
                    marketRegime: marketContext.trend === 'up' ? 'trending_up' :
                        marketContext.trend === 'down' ? 'trending_down' :
                            'ranging',
                    mlPredictions: mlPredictions // Add ML predictions to context
                };
                const strategyData = await llmStrategyGenerator.generateStrategy(llmMarketContext);
                const strategy = {
                    id: `${session.id}-strategy-${Date.now()}-${i}`,
                    sessionId: session.id,
                    strategyName: strategyData.name || `AI Strategy ${i + 1}`,
                    strategyCode: JSON.stringify(strategyData),
                    generationPrompt: prompt,
                    claudeResponse: JSON.stringify(strategyData),
                    backtestScore: 0,
                    status: 'generated',
                    createdAt: new Date()
                };
                // Save to database
                await pool.query(`INSERT INTO agent_strategies (id, session_id, strategy_name, strategy_code, generation_prompt, claude_response, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, [strategy.id, strategy.sessionId, strategy.strategyName, strategy.strategyCode,
                    strategy.generationPrompt, strategy.claudeResponse, strategy.status]);
                strategies.push(strategy);
                await this.logActivity(session.id, 'strategy_generated', `Generated strategy: ${strategy.strategyName}`);
            }
            catch (err) {
                console.error(`[Agent ${session.id}] Error generating strategy ${i}:`, err);
            }
        }
        // Update session
        session.strategiesGenerated += strategies.length;
        await pool.query(`UPDATE agent_sessions SET strategies_generated = strategies_generated + $1 WHERE id = $2`, [strategies.length, session.id]);
        return strategies;
    }
    /**
     * Backtest strategies in parallel
     */
    async backtestStrategies(session, strategies) {
        const backtestPromises = strategies.map(async (strategy) => {
            try {
                const strategyData = JSON.parse(strategy.strategyCode);
                const result = await backtestingEngine.runBacktest(strategy.strategyName, {
                    symbol: session.config.preferredPairs[0],
                    startDate: new Date(Date.now() - session.config.backtestPeriodDays * 24 * 60 * 60 * 1000),
                    endDate: new Date(),
                    initialCapital: 10000,
                    feeRate: 0.075 // Poloniex taker fee
                });
                // Calculate backtest score (Sharpe ratio weighted with profitability)
                const score = result.sharpeRatio * (1 + result.totalReturn / 100);
                strategy.backtestScore = score;
                strategy.status = 'backtested';
                // Update database
                await pool.query(`UPDATE agent_strategies SET backtest_score = $1, status = $2 WHERE id = $3`, [score, 'backtested', strategy.id]);
                await this.logActivity(session.id, 'backtest_completed', `Backtest completed for ${strategy.strategyName}: Score ${score.toFixed(2)}`);
                return strategy;
            }
            catch (err) {
                console.error(`[Agent ${session.id}] Error backtesting strategy ${strategy.strategyName}:`, err);
                return null;
            }
        });
        const results = await Promise.all(backtestPromises);
        const successfulResults = results.filter(r => r !== null);
        // Update session
        session.backtestsCompleted += successfulResults.length;
        await pool.query(`UPDATE agent_sessions SET backtests_completed = backtests_completed + $1 WHERE id = $2`, [successfulResults.length, session.id]);
        return successfulResults;
    }
    /**
     * Select top performing strategies
     */
    selectTopStrategies(strategies, topN) {
        return strategies
            .filter(s => s.backtestScore > 1.0) // Only strategies with positive Sharpe-weighted return
            .sort((a, b) => b.backtestScore - a.backtestScore)
            .slice(0, topN);
    }
    /**
     * Start paper trading for top strategies
     */
    async startPaperTrading(session, strategies) {
        for (const strategy of strategies) {
            try {
                const strategyData = JSON.parse(strategy.strategyCode);
                // Start paper trading session
                await paperTradingService.startSession({
                    userId: session.userId,
                    strategy: strategyData,
                    initialBalance: 10000,
                    symbol: session.config.preferredPairs[0]
                });
                strategy.status = 'paper_trading';
                await pool.query(`UPDATE agent_strategies SET status = $1 WHERE id = $2`, ['paper_trading', strategy.id]);
                await this.logActivity(session.id, 'paper_trading_started', `Started paper trading for ${strategy.strategyName}`);
            }
            catch (err) {
                console.error(`[Agent ${session.id}] Error starting paper trading for ${strategy.strategyName}:`, err);
            }
        }
    }
    /**
     * Evaluate paper trading results
     */
    async evaluatePaperTradingResults(session) {
        // Get strategies currently in paper trading
        const result = await pool.query(`SELECT * FROM agent_strategies 
       WHERE session_id = $1 AND status = 'paper_trading'`, [session.id]);
        for (const row of result.rows) {
            // Check if paper trading duration has passed
            const createdAt = new Date(row.created_at);
            const hoursPassed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
            if (hoursPassed >= session.config.paperTradingDurationHours) {
                try {
                    // Get actual paper trading results from paper trading service
                    const strategyData = JSON.parse(row.strategy_code);
                    let paperTradingScore = 0;
                    try {
                        // Get all active paper trading sessions
                        const activeSessions = paperTradingService.getActiveSessions();
                        // Find session matching this strategy
                        const matchingSession = activeSessions.find((s) => s.strategyName === row.strategy_name);
                        if (matchingSession) {
                            // Calculate score based on paper trading performance
                            const winRate = matchingSession.winRate / 100; // Convert to 0-1 range
                            // Calculate profit factor: Use a simplified approach
                            // If we have winning and losing trades, estimate profit factor
                            let profitFactor = 1.0; // Default neutral
                            if (matchingSession.totalTrades > 0) {
                                // Use win rate and realized PnL to estimate profit factor
                                // Higher win rate + positive PnL = higher profit factor
                                const returnPercent = ((matchingSession.currentValue - matchingSession.initialCapital) / matchingSession.initialCapital) * 100;
                                if (returnPercent > 0 && winRate > 0) {
                                    // Profitable strategy: estimate profit factor based on win rate
                                    profitFactor = 1 + (winRate * 2); // Range: 1.0 to 3.0
                                }
                                else if (returnPercent < 0) {
                                    // Losing strategy: low profit factor
                                    profitFactor = 0.5;
                                }
                            }
                            const totalReturn = ((matchingSession.currentValue - matchingSession.initialCapital) / matchingSession.initialCapital) * 100;
                            // Weighted score calculation:
                            // - Return: 40% weight, scale 10% return to 0.4 contribution
                            // - Win Rate: 30% weight, 100% win rate = 0.3 contribution  
                            // - Profit Factor: 30% weight, profit factor of 3 = 0.3 contribution
                            const returnScore = Math.max(-1, Math.min(1, totalReturn / 25)) * 0.4; // Scale -25% to +25% return to -0.4 to +0.4
                            const winRateScore = winRate * 0.3; // 0 to 0.3
                            const profitFactorScore = (Math.min(profitFactor, 3) / 3) * 0.3; // 0 to 0.3
                            paperTradingScore = returnScore + winRateScore + profitFactorScore;
                            logger.info(`Paper trading results for ${row.strategy_name}: score=${paperTradingScore.toFixed(2)}, return=${totalReturn.toFixed(2)}%, winRate=${(winRate * 100).toFixed(1)}%, profitFactor=${profitFactor.toFixed(2)}`);
                        }
                        else {
                            logger.warn(`No paper trading session found for strategy ${row.strategy_name}`);
                            // Use a neutral score if we can't find the session
                            paperTradingScore = 0.8;
                        }
                    }
                    catch (paperError) {
                        logger.error(`Error fetching paper trading results: ${paperError.message}`);
                        // Use a conservative score if we can't get results
                        paperTradingScore = 0.8;
                    }
                    // Threshold for promotion: score must be > 1.2 (positive returns with good metrics)
                    if (paperTradingScore > 1.2) {
                        // Promote to live trading
                        await pool.query(`UPDATE agent_strategies 
               SET status = $1, paper_trading_score = $2, promoted_at = NOW()
               WHERE id = $3`, ['live', paperTradingScore, row.id]);
                        await this.logActivity(session.id, 'strategy_promoted', `Strategy ${row.strategy_name} promoted to live trading (score: ${paperTradingScore.toFixed(2)})`);
                        // Start live trading by registering strategy with automated trading service
                        try {
                            await automatedTradingService.registerStrategy(session.userId, {
                                id: row.id,
                                name: row.strategy_name,
                                type: 'autonomous_ai', // Mark as AI-generated strategy
                                symbol: session.config.preferredPairs[0],
                                parameters: strategyData,
                                accountId: null // Will use user's default account
                            });
                            logger.info(`Started live trading for strategy ${row.strategy_name}`);
                            await this.logActivity(session.id, 'live_trading_started', `Live trading started for strategy ${row.strategy_name}`);
                            // Update session stats
                            session.liveTradesExecuted += 1;
                            await pool.query(`UPDATE agent_sessions SET live_trades_executed = live_trades_executed + 1 WHERE id = $1`, [session.id]);
                        }
                        catch (tradingError) {
                            logger.error(`Failed to start live trading for ${row.strategy_name}:`, tradingError);
                            // Rollback strategy to paper trading status
                            await pool.query(`UPDATE agent_strategies SET status = 'paper_trading' WHERE id = $1`, [row.id]);
                            await this.logActivity(session.id, 'live_trading_failed', `Failed to start live trading for ${row.strategy_name}: ${tradingError.message}`);
                        }
                    }
                    else {
                        // Retire strategy due to poor performance
                        await pool.query(`UPDATE agent_strategies 
               SET status = $1, paper_trading_score = $2, retired_at = NOW()
               WHERE id = $3`, ['retired', paperTradingScore, row.id]);
                        await this.logActivity(session.id, 'strategy_retired', `Strategy ${row.strategy_name} retired (score: ${paperTradingScore.toFixed(2)} < 1.2 threshold)`);
                    }
                }
                catch (err) {
                    logger.error(`Error evaluating paper trading for strategy ${row.strategy_name}:`, err);
                    await this.logActivity(session.id, 'evaluation_error', `Error evaluating ${row.strategy_name}: ${err.message}`);
                }
            }
        }
    }
    /**
     * Learn from results and adapt
     */
    async learnAndAdapt(session) {
        // Analyze all completed strategies
        const result = await pool.query(`SELECT * FROM agent_strategies 
       WHERE session_id = $1 AND status IN ('retired', 'live')
       ORDER BY created_at DESC LIMIT 10`, [session.id]);
        const learnings = [];
        for (const row of result.rows) {
            if (row.status === 'live') {
                // Learn from successful strategies
                learnings.push({
                    sessionId: session.id,
                    learningType: 'strategy_success',
                    context: { strategy: row.strategy_name, score: row.backtest_score },
                    insight: `Strategy ${row.strategy_name} succeeded with score ${row.backtest_score}`,
                    confidence: 0.8
                });
            }
            else if (row.status === 'retired') {
                // Learn from failed strategies
                learnings.push({
                    sessionId: session.id,
                    learningType: 'strategy_failure',
                    context: { strategy: row.strategy_name, score: row.backtest_score },
                    insight: `Strategy ${row.strategy_name} failed in paper trading`,
                    confidence: 0.7
                });
            }
        }
        // Save learnings to database
        for (const learning of learnings) {
            await pool.query(`INSERT INTO agent_learnings (session_id, learning_type, context, insight, confidence)
         VALUES ($1, $2, $3, $4, $5)`, [learning.sessionId, learning.learningType, JSON.stringify(learning.context),
                learning.insight, learning.confidence]);
        }
        await this.logActivity(session.id, 'learning_completed', `Analyzed ${learnings.length} strategy outcomes`);
    }
    /**
     * Helper: Get market context
     */
    async getMarketContext(pair) {
        try {
            // Fetch real market data from Poloniex
            const poloniexService = (await import('./poloniexFuturesService.js')).default;
            // Get recent candlesticks to determine trend
            const candles = await poloniexService.getHistoricalData(pair, '1h', 24);
            if (!candles || candles.length === 0) {
                logger.warn(`No market data available for ${pair}, using defaults`);
                return {
                    pair,
                    price: 0,
                    trend: 'neutral',
                    volatility: 'medium',
                    volume: 'medium'
                };
            }
            // Calculate trend (comparing first and last price)
            const firstPrice = parseFloat(candles[0].close);
            const lastPrice = parseFloat(candles[candles.length - 1].close);
            const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
            let trend = 'neutral';
            if (priceChange > 2)
                trend = 'bullish';
            else if (priceChange < -2)
                trend = 'bearish';
            // Calculate volatility (standard deviation of closes)
            const closes = candles.map((c) => parseFloat(c.close));
            const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
            const variance = closes.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / closes.length;
            const stdDev = Math.sqrt(variance);
            const volatilityPercent = (stdDev / avg) * 100;
            let volatility = 'medium';
            if (volatilityPercent > 5)
                volatility = 'high';
            else if (volatilityPercent < 2)
                volatility = 'low';
            // Calculate volume
            const volumes = candles.map((c) => parseFloat(c.volume));
            const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
            const recentVolume = volumes.slice(-6).reduce((a, b) => a + b, 0) / 6;
            let volume = 'medium';
            if (recentVolume > avgVolume * 1.5)
                volume = 'high';
            else if (recentVolume < avgVolume * 0.5)
                volume = 'low';
            return {
                pair,
                price: lastPrice,
                trend,
                volatility,
                volume,
                priceChange24h: priceChange,
                avgPrice: avg,
                volatilityPercent
            };
        }
        catch (error) {
            logger.error(`Error fetching market context for ${pair}:`, error);
            // Return defaults on error
            return {
                pair,
                price: 0,
                trend: 'neutral',
                volatility: 'medium',
                volume: 'medium'
            };
        }
    }
    /**
     * Helper: Build strategy generation prompt
     */
    buildStrategyGenerationPrompt(config, marketContext, index) {
        return `Generate a ${config.tradingStyle} trading strategy for ${config.preferredPairs[0]} 
            with ${marketContext.trend} market trend and ${marketContext.volatility} volatility. 
            This is variation ${index + 1}.`;
    }
    /**
     * Helper: Log activity
     */
    async logActivity(sessionId, activityType, description) {
        await pool.query(`INSERT INTO agent_activity_log (session_id, activity_type, description)
       VALUES ($1, $2, $3)`, [sessionId, activityType, description]);
    }
}
export const autonomousTradingAgent = new AutonomousTradingAgent();
