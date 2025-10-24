import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import confidenceScoringService from './confidenceScoringService.js';
class StrategyOptimizer extends EventEmitter {
    constructor() {
        super();
        this.backtestQueue = [];
        this.paperTradingQueue = [];
        this.livePromotionQueue = [];
        this.isProcessing = false;
        this.thresholds = {
            backtestMinProfit: 0.05,
            backtestMinWinRate: 0.45,
            backtestMinSharpe: 0.5,
            backtestMaxDrawdown: 0.15,
            paperTradeMinProfit: 0.03,
            paperTradeMinTrades: 10,
            paperTradeDurationHours: 48,
            livePromotionMinProfit: 0.05,
            livePromotionMinConfidence: 75,
            livePromotionMinTrades: 20,
            retirementMaxDrawdown: 0.20,
            retirementMinWinRate: 0.30,
            retirementLookbackDays: 7
        };
        this.optimizationStats = {
            backtestsCompleted: 0,
            paperTradingPromotions: 0,
            livePromotions: 0,
            retirements: 0,
            totalStrategiesTested: 0
        };
        this.logger = logger;
    }
    async queueForBacktest(strategy) {
        this.backtestQueue.push(strategy);
        this.logger.info(`📋 Queued strategy ${strategy.id} for backtesting`);
        if (!this.isProcessing) {
            this.processQueues();
        }
    }
    async queueForPaperTrading(strategy) {
        this.paperTradingQueue.push(strategy);
        this.logger.info(`📋 Queued strategy ${strategy.id} for paper trading`);
        if (!this.isProcessing) {
            this.processQueues();
        }
    }
    async queueForLivePromotion(strategy) {
        this.livePromotionQueue.push(strategy);
        this.logger.info(`📋 Queued strategy ${strategy.id} for live promotion`);
        if (!this.isProcessing) {
            this.processQueues();
        }
    }
    async processQueues() {
        if (this.isProcessing)
            return;
        this.isProcessing = true;
        try {
            while (this.backtestQueue.length > 0) {
                const strategy = this.backtestQueue.shift();
                await this.runBacktest(strategy);
            }
            while (this.paperTradingQueue.length > 0) {
                const strategy = this.paperTradingQueue.shift();
                await this.startPaperTrading(strategy);
            }
            while (this.livePromotionQueue.length > 0) {
                const strategy = this.livePromotionQueue.shift();
                await this.promoteToLive(strategy);
            }
        }
        finally {
            this.isProcessing = false;
        }
    }
    async runBacktest(strategy) {
        try {
            this.logger.info(`🔬 Starting backtest for strategy ${strategy.id}...`);
            backtestingEngine.registerStrategy(strategy.id, {
                name: strategy.name,
                type: strategy.type,
                parameters: strategy.parameters
            });
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
            const backtestResult = await backtestingEngine.runBacktest(strategy.id, strategy.symbol, strategy.timeframe, startDate, endDate, {
                initialCapital: 10000,
                commission: 0.001,
                slippage: 0.001
            });
            const evaluation = this.evaluateBacktestResult(backtestResult);
            strategy.performance.backtestScore = evaluation.score;
            strategy.performance.profit = evaluation.totalReturn;
            strategy.performance.winRate = evaluation.winRate;
            strategy.performance.sharpeRatio = evaluation.sharpeRatio;
            strategy.performance.maxDrawdown = evaluation.maxDrawdown;
            strategy.performance.trades = evaluation.totalTrades;
            if (evaluation.passedThreshold) {
                strategy.status = 'backtested';
                this.logger.info(`✅ Strategy ${strategy.id} passed backtest - queuing for paper trading`);
                await this.queueForPaperTrading(strategy);
            }
            else {
                strategy.status = 'failed_backtest';
                this.logger.info(`❌ Strategy ${strategy.id} failed backtest - ${evaluation.failureReason}`);
            }
            this.optimizationStats.backtestsCompleted++;
            this.optimizationStats.totalStrategiesTested++;
            this.emit('backtestCompleted', {
                strategyId: strategy.id,
                result: backtestResult,
                evaluation,
                passed: evaluation.passedThreshold
            });
        }
        catch (error) {
            this.logger.error(`❌ Backtest failed for strategy ${strategy.id}:`, error);
            strategy.status = 'backtest_error';
            strategy.error = error.message;
        }
    }
    evaluateBacktestResult(result) {
        const evaluation = {
            score: 0,
            totalReturn: result.totalReturn || 0,
            winRate: result.winRate || 0,
            sharpeRatio: result.sharpeRatio || 0,
            maxDrawdown: result.maxDrawdown || 0,
            totalTrades: result.totalTrades || 0,
            passedThreshold: false,
            failureReason: null
        };
        if (evaluation.totalReturn < this.thresholds.backtestMinProfit) {
            evaluation.failureReason = `Profit ${(evaluation.totalReturn * 100).toFixed(2)}% < ${(this.thresholds.backtestMinProfit * 100)}%`;
            return evaluation;
        }
        if (evaluation.winRate < this.thresholds.backtestMinWinRate) {
            evaluation.failureReason = `Win rate ${(evaluation.winRate * 100).toFixed(2)}% < ${(this.thresholds.backtestMinWinRate * 100)}%`;
            return evaluation;
        }
        if (evaluation.sharpeRatio < this.thresholds.backtestMinSharpe) {
            evaluation.failureReason = `Sharpe ratio ${evaluation.sharpeRatio.toFixed(2)} < ${this.thresholds.backtestMinSharpe}`;
            return evaluation;
        }
        if (evaluation.maxDrawdown > this.thresholds.backtestMaxDrawdown) {
            evaluation.failureReason = `Max drawdown ${(evaluation.maxDrawdown * 100).toFixed(2)}% > ${(this.thresholds.backtestMaxDrawdown * 100)}%`;
            return evaluation;
        }
        evaluation.score = ((evaluation.totalReturn * 30) +
            (evaluation.winRate * 20) +
            (evaluation.sharpeRatio * 20) +
            ((1 - evaluation.maxDrawdown) * 15) +
            (Math.min(evaluation.totalTrades / 50, 1) * 15));
        evaluation.passedThreshold = true;
        return evaluation;
    }
    async startPaperTrading(strategy) {
        try {
            this.logger.info(`📝 Starting paper trading for strategy ${strategy.id}...`);
            const sessionConfig = {
                name: `Paper - ${strategy.name}`,
                strategyName: strategy.id,
                symbol: strategy.symbol,
                timeframe: strategy.timeframe,
                initialCapital: 10000,
                riskParameters: {
                    maxDailyLoss: 0.05,
                    maxPositionSize: 0.1,
                    stopLossPercent: strategy.parameters.stopLoss || 0.02,
                    takeProfitPercent: strategy.parameters.takeProfit || 0.04,
                    riskPerTrade: 0.02
                }
            };
            const session = await paperTradingService.createSession(sessionConfig);
            await paperTradingService.startSession(session.id, {
                strategy: strategy.id,
                parameters: strategy.parameters
            });
            strategy.paperTradingSessionId = session.id;
            strategy.paperTradingStartTime = new Date();
            strategy.status = 'paper_trading';
            this.optimizationStats.paperTradingPromotions++;
            this.emit('paperTradingStarted', {
                strategyId: strategy.id,
                sessionId: session.id,
                strategy
            });
            setTimeout(async () => {
                await this.evaluatePaperTrading(strategy);
            }, this.thresholds.paperTradeDurationHours * 60 * 60 * 1000);
        }
        catch (error) {
            this.logger.error(`❌ Paper trading failed for strategy ${strategy.id}:`, error);
            strategy.status = 'paper_trading_error';
            strategy.error = error.message;
        }
    }
    async evaluatePaperTrading(strategy) {
        try {
            const session = paperTradingService.getSession(strategy.paperTradingSessionId);
            if (!session) {
                this.logger.error(`❌ Paper trading session not found for strategy ${strategy.id}`);
                return;
            }
            const totalReturn = (session.currentValue - session.initialCapital) / session.initialCapital;
            const winRate = session.totalTrades > 0 ? session.winningTrades / session.totalTrades : 0;
            const totalTrades = session.totalTrades;
            strategy.performance.paperTradeScore = totalReturn * 100;
            strategy.performance.profit = totalReturn;
            strategy.performance.winRate = winRate;
            strategy.performance.trades = totalTrades;
            const shouldPromote = (totalReturn >= this.thresholds.paperTradeMinProfit &&
                totalTrades >= this.thresholds.paperTradeMinTrades &&
                winRate >= this.thresholds.backtestMinWinRate);
            if (shouldPromote) {
                this.logger.info(`✅ Strategy ${strategy.id} ready for live promotion`);
                await this.queueForLivePromotion(strategy);
            }
            else {
                this.logger.info(`❌ Strategy ${strategy.id} failed paper trading evaluation`);
                strategy.status = 'failed_paper_trading';
                await paperTradingService.stopSession(strategy.paperTradingSessionId);
            }
            this.emit('paperTradingEvaluated', {
                strategyId: strategy.id,
                sessionId: strategy.paperTradingSessionId,
                totalReturn,
                winRate,
                totalTrades,
                promoted: shouldPromote
            });
        }
        catch (error) {
            this.logger.error(`❌ Paper trading evaluation failed for strategy ${strategy.id}:`, error);
        }
    }
    async promoteToLive(strategy) {
        try {
            this.logger.info(`🚀 Promoting strategy ${strategy.id} to live trading...`);
            const confidenceAssessment = await confidenceScoringService.calculateConfidenceScore(strategy.id, strategy.symbol, strategy.timeframe);
            if (confidenceAssessment.confidenceScore < this.thresholds.livePromotionMinConfidence) {
                this.logger.info(`❌ Strategy ${strategy.id} confidence too low for live promotion: ${confidenceAssessment.confidenceScore}%`);
                strategy.status = 'failed_confidence';
                return;
            }
            strategy.status = 'live';
            strategy.livePromotionTime = new Date();
            strategy.performance.confidence = confidenceAssessment.confidenceScore;
            strategy.performance.liveTradeScore = 0;
            if (strategy.paperTradingSessionId) {
                await paperTradingService.stopSession(strategy.paperTradingSessionId);
            }
            this.optimizationStats.livePromotions++;
            this.emit('livePromotionCompleted', {
                strategyId: strategy.id,
                confidenceScore: confidenceAssessment.confidenceScore,
                strategy
            });
            this.logger.info(`✅ Strategy ${strategy.id} promoted to live trading with ${confidenceAssessment.confidenceScore}% confidence`);
        }
        catch (error) {
            this.logger.error(`❌ Live promotion failed for strategy ${strategy.id}:`, error);
            strategy.status = 'live_promotion_error';
            strategy.error = error.message;
        }
    }
    async evaluateForRetirement(strategy) {
        try {
            const lookbackTime = Date.now() - (this.thresholds.retirementLookbackDays * 24 * 60 * 60 * 1000);
            const recentPerformance = await this.getRecentPerformance(strategy.id, lookbackTime);
            const shouldRetire = (recentPerformance.drawdown > this.thresholds.retirementMaxDrawdown ||
                recentPerformance.winRate < this.thresholds.retirementMinWinRate ||
                recentPerformance.profitFactor < 0.8);
            if (shouldRetire) {
                await this.retireStrategy(strategy, recentPerformance);
            }
        }
        catch (error) {
            this.logger.error(`❌ Retirement evaluation failed for strategy ${strategy.id}:`, error);
        }
    }
    async retireStrategy(strategy, performance) {
        try {
            this.logger.info(`🏁 Retiring strategy ${strategy.id} due to poor performance`);
            strategy.status = 'retired';
            strategy.retirementTime = new Date();
            strategy.retirementReason = this.getRetirementReason(performance);
            if (strategy.paperTradingSessionId) {
                await paperTradingService.stopSession(strategy.paperTradingSessionId);
            }
            this.optimizationStats.retirements++;
            this.emit('strategyRetired', {
                strategyId: strategy.id,
                reason: strategy.retirementReason,
                performance
            });
        }
        catch (error) {
            this.logger.error(`❌ Strategy retirement failed for ${strategy.id}:`, error);
        }
    }
    getRetirementReason(performance) {
        if (performance.drawdown > this.thresholds.retirementMaxDrawdown) {
            return `Excessive drawdown: ${(performance.drawdown * 100).toFixed(2)}%`;
        }
        if (performance.winRate < this.thresholds.retirementMinWinRate) {
            return `Low win rate: ${(performance.winRate * 100).toFixed(2)}%`;
        }
        if (performance.profitFactor < 0.8) {
            return `Poor profit factor: ${performance.profitFactor.toFixed(2)}`;
        }
        return 'General underperformance';
    }
    async getRecentPerformance(strategyId, since) {
        return {
            drawdown: Math.random() * 0.3,
            winRate: 0.3 + Math.random() * 0.4,
            profitFactor: 0.5 + Math.random() * 1.0,
            totalTrades: Math.floor(Math.random() * 50) + 10,
            profit: (Math.random() - 0.5) * 0.2
        };
    }
    getStats() {
        return {
            ...this.optimizationStats,
            queues: {
                backtest: this.backtestQueue.length,
                paperTrading: this.paperTradingQueue.length,
                livePromotion: this.livePromotionQueue.length
            },
            thresholds: this.thresholds
        };
    }
    updateThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        this.logger.info('📊 Optimization thresholds updated');
        this.emit('thresholdsUpdated', this.thresholds);
    }
}
export default new StrategyOptimizer();
