import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import confidenceScoringService from './confidenceScoringService.js';
import poloniexFuturesService from './poloniexFuturesService.js';
class AutonomousStrategyGenerator extends EventEmitter {
    constructor() {
        super();
        this.strategies = new Map();
        this.activeStrategies = new Map();
        this.retiredStrategies = new Map();
        this.generationCount = 0;
        this.isRunning = false;
        this.riskTolerance = {
            maxDrawdown: 0.15,
            riskPerTrade: 0.02,
            maxPositionSize: 0.1,
            profitBankingPercent: 0.3
        };
        this.generationConfig = {
            populationSize: 20,
            maxGenerations: 100,
            mutationRate: 0.1,
            crossoverRate: 0.7,
            elitismRate: 0.2,
            diversityThreshold: 0.8,
            performanceWindow: 168,
            minBacktestPeriod: 30
        };
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
    }
    async initialize() {
        try {
            this.logger.info('🧠 Initializing Autonomous Strategy Generator...');
            await this.loadExistingStrategies();
            if (this.strategies.size === 0) {
                await this.createInitialPopulation();
            }
            this.logger.info(`✅ Autonomous Strategy Generator initialized with ${this.strategies.size} strategies`);
            this.emit('initialized', { strategiesCount: this.strategies.size });
            return true;
        }
        catch (error) {
            this.logger.error('❌ Failed to initialize Autonomous Strategy Generator:', error);
            throw error;
        }
    }
    async start() {
        if (this.isRunning) {
            this.logger.warn('Autonomous Strategy Generator is already running');
            return;
        }
        this.isRunning = true;
        this.logger.info('🚀 Starting Autonomous Strategy Generation...');
        try {
            this.evolutionLoop();
            this.emit('started');
            this.logger.info('✅ Autonomous Strategy Generation started');
        }
        catch (error) {
            this.logger.error('❌ Failed to start Autonomous Strategy Generation:', error);
            this.isRunning = false;
            throw error;
        }
    }
    async stop() {
        this.isRunning = false;
        this.logger.info('⏹️ Stopping Autonomous Strategy Generation...');
        for (const [strategyId, strategy] of this.activeStrategies) {
            await this.deactivateStrategy(strategyId);
        }
        this.emit('stopped');
        this.logger.info('✅ Autonomous Strategy Generation stopped');
    }
    async evolutionLoop() {
        while (this.isRunning) {
            try {
                this.logger.info(`🔄 Starting generation ${this.generationCount + 1}...`);
                await this.evaluateStrategies();
                await this.generateNewStrategies();
                await this.backtestStrategies();
                await this.selectForPaperTrading();
                await this.promoteToLiveTrading();
                await this.retireStrategies();
                await this.bankProfits();
                await this.maintainDiversity();
                this.generationCount++;
                this.emit('generationComplete', {
                    generation: this.generationCount,
                    totalStrategies: this.strategies.size,
                    activeStrategies: this.activeStrategies.size,
                    performance: this.performanceMetrics
                });
                await this.sleep(30 * 60 * 1000);
            }
            catch (error) {
                this.logger.error('❌ Error in evolution loop:', error);
                await this.sleep(60 * 1000);
            }
        }
    }
    async createInitialPopulation() {
        this.logger.info('🧪 Creating initial strategy population...');
        const symbols = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT'];
        const strategyTypes = ['momentum', 'mean_reversion', 'breakout', 'trend_following'];
        for (let i = 0; i < this.generationConfig.populationSize; i++) {
            const strategy = this.generateRandomStrategy(symbols, strategyTypes);
            this.strategies.set(strategy.id, strategy);
            this.logger.info(`Created strategy ${strategy.id}: ${strategy.name}`);
        }
        this.logger.info(`✅ Created ${this.strategies.size} initial strategies`);
    }
    generateRandomStrategy(symbols, strategyTypes) {
        const id = `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
        const type = strategyTypes[Math.floor(Math.random() * strategyTypes.length)];
        const timeframe = this.parameterRanges.timeframes[Math.floor(Math.random() * this.parameterRanges.timeframes.length)];
        const indicators = this.selectRandomIndicators();
        const parameters = this.generateRandomParameters(type, indicators);
        return {
            id,
            name: `Auto ${type} ${symbol} ${timeframe}`,
            type,
            symbol,
            timeframe,
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
    selectRandomIndicators() {
        const indicators = [];
        const categories = Object.keys(this.indicatorLibrary);
        const numIndicators = Math.floor(Math.random() * 3) + 2;
        const selectedCategories = this.shuffleArray(categories).slice(0, numIndicators);
        for (const category of selectedCategories) {
            const categoryIndicators = this.indicatorLibrary[category];
            const indicator = categoryIndicators[Math.floor(Math.random() * categoryIndicators.length)];
            indicators.push({ category, indicator });
        }
        return indicators;
    }
    generateRandomParameters(type, indicators) {
        const parameters = {};
        parameters.stopLoss = this.randomFloat(0.01, 0.05);
        parameters.takeProfit = this.randomFloat(0.02, 0.08);
        parameters.positionSize = this.randomFloat(0.01, this.riskTolerance.maxPositionSize);
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
    async evaluateStrategies() {
        this.logger.info('📊 Evaluating strategy performance...');
        for (const [strategyId, strategy] of this.strategies) {
            try {
                if (strategy.status === 'live') {
                    await this.updateLivePerformance(strategy);
                }
                else if (strategy.status === 'paper_trading') {
                    await this.updatePaperPerformance(strategy);
                }
                else if (strategy.status === 'backtested') {
                    await this.updateBacktestPerformance(strategy);
                }
                strategy.fitness = this.calculateFitnessScore(strategy);
            }
            catch (error) {
                this.logger.error(`Error evaluating strategy ${strategyId}:`, error);
            }
        }
    }
    async generateNewStrategies() {
        this.logger.info('🧬 Generating new strategies...');
        const topPerformers = Array.from(this.strategies.values())
            .sort((a, b) => (b.fitness || 0) - (a.fitness || 0))
            .slice(0, Math.floor(this.strategies.size * this.generationConfig.elitismRate));
        const newStrategies = [];
        for (let i = 0; i < Math.floor(this.generationConfig.populationSize * 0.3); i++) {
            if (Math.random() < this.generationConfig.crossoverRate && topPerformers.length >= 2) {
                const parent1 = topPerformers[Math.floor(Math.random() * topPerformers.length)];
                const parent2 = topPerformers[Math.floor(Math.random() * topPerformers.length)];
                const offspring = this.crossoverStrategies(parent1, parent2);
                newStrategies.push(offspring);
            }
            else if (topPerformers.length > 0) {
                const parent = topPerformers[Math.floor(Math.random() * topPerformers.length)];
                const mutated = this.mutateStrategy(parent);
                newStrategies.push(mutated);
            }
        }
        for (const strategy of newStrategies) {
            this.strategies.set(strategy.id, strategy);
        }
        this.logger.info(`✅ Generated ${newStrategies.length} new strategies`);
    }
    crossoverStrategies(parent1, parent2) {
        const id = `cross_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const parameters = {};
        for (const key in parent1.parameters) {
            parameters[key] = Math.random() < 0.5 ? parent1.parameters[key] : parent2.parameters[key];
        }
        const indicators = [...parent1.indicators, ...parent2.indicators]
            .filter((indicator, index, self) => index === self.findIndex(i => i.indicator === indicator.indicator))
            .slice(0, 4);
        return {
            id,
            name: `Cross ${parent1.type} x ${parent2.type}`,
            type: Math.random() < 0.5 ? parent1.type : parent2.type,
            symbol: Math.random() < 0.5 ? parent1.symbol : parent2.symbol,
            timeframe: Math.random() < 0.5 ? parent1.timeframe : parent2.timeframe,
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
    mutateStrategy(parent) {
        const id = `mut_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        for (const key in mutated.parameters) {
            if (Math.random() < this.generationConfig.mutationRate) {
                if (typeof mutated.parameters[key] === 'number') {
                    const noise = (Math.random() - 0.5) * 0.2;
                    mutated.parameters[key] *= (1 + noise);
                    mutated.parameters[key] = Math.max(0.001, Math.min(1.0, mutated.parameters[key]));
                }
            }
        }
        if (Math.random() < this.generationConfig.mutationRate * 0.5) {
            const newIndicators = this.selectRandomIndicators();
            mutated.indicators = newIndicators;
        }
        return mutated;
    }
    calculateFitnessScore(strategy) {
        const perf = strategy.performance;
        const profitScore = Math.max(0, perf.profit) * 0.3;
        const winRateScore = (perf.winRate || 0) * 0.2;
        const sharpeScore = Math.max(0, perf.sharpeRatio || 0) * 0.2;
        const drawdownPenalty = Math.max(0, perf.maxDrawdown || 0) * -0.2;
        const confidenceScore = (perf.confidence || 0) * 0.1;
        return profitScore + winRateScore + sharpeScore + drawdownPenalty + confidenceScore;
    }
    async bankProfits() {
        if (this.performanceMetrics.totalProfit > 100) {
            const bankAmount = this.performanceMetrics.totalProfit * this.riskTolerance.profitBankingPercent;
            try {
                this.performanceMetrics.bankedProfits += bankAmount;
                this.performanceMetrics.totalProfit -= bankAmount;
                this.logger.info(`💰 Banked ${bankAmount.toFixed(2)} USDT to spot account`);
                this.emit('profitBanked', { amount: bankAmount, totalBanked: this.performanceMetrics.bankedProfits });
            }
            catch (error) {
                this.logger.error('❌ Failed to bank profits:', error);
            }
        }
    }
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
    async loadExistingStrategies() { }
    async backtestStrategies() { }
    async selectForPaperTrading() { }
    async promoteToLiveTrading() { }
    async retireStrategies() { }
    async maintainDiversity() { }
    async updateLivePerformance() { }
    async updatePaperPerformance() { }
    async updateBacktestPerformance() { }
    async deactivateStrategy() { }
}
export default new AutonomousStrategyGenerator();
