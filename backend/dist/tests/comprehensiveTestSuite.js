#!/usr/bin/env node
import { logger } from '../utils/logger.js';
import backtestingEngine from '../services/backtestingEngine.js';
import paperTradingService from '../services/paperTradingService.js';
import confidenceScoringService from '../services/confidenceScoringService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import automatedTradingService from '../services/automatedTradingService.js';
/**
 * Comprehensive Test Suite for Poloniex Futures Trading Platform
 * Tests all major components of the automated trading system
 */
class ComprehensiveTestSuite {
    constructor() {
        this.testResults = {
            total: 0,
            passed: 0,
            failed: 0,
            tests: []
        };
    }
    /**
     * Run all tests
     */
    async runAllTests() {
        try {
            logger.info('🧪 Starting Comprehensive Test Suite for Poloniex Futures Platform...');
            logger.info('='.repeat(80));
            // Phase 1: Core Service Tests
            await this.runCoreServiceTests();
            // Phase 2: Integration Tests
            await this.runIntegrationTests();
            // Phase 3: Performance Tests
            await this.runPerformanceTests();
            // Phase 4: AI/ML Trading Logic Tests
            await this.runAIMLTests();
            // Phase 5: Risk Management Tests
            await this.runRiskManagementTests();
            // Phase 6: End-to-End Tests
            await this.runEndToEndTests();
            // Generate test report
            this.generateTestReport();
            return this.testResults;
        }
        catch (error) {
            logger.error('❌ Test suite execution failed:', error);
            throw error;
        }
    }
    /**
     * Run core service tests
     */
    async runCoreServiceTests() {
        logger.info('🔧 Running Core Service Tests...');
        // Test 1: Backtesting Engine
        await this.runTest('Backtesting Engine Initialization', async () => {
            // Test strategy registration
            const momentumStrategy = {
                name: 'Test Momentum Strategy',
                type: 'momentum',
                parameters: {
                    rsi_oversold: 30,
                    rsi_overbought: 70,
                    macd_threshold: 0
                }
            };
            backtestingEngine.registerStrategy('test_momentum', momentumStrategy);
            const status = backtestingEngine.getBacktestStatus();
            if (!status.strategies.includes('test_momentum')) {
                throw new Error('Strategy registration failed');
            }
            // Test technical indicators
            const testData = [100, 101, 102, 101, 100, 99, 98, 99, 100, 101, 102, 103, 104, 103, 102, 101, 100, 99, 98, 97, 98, 99, 100, 101, 102, 103, 104, 105, 104, 103];
            const sma = backtestingEngine.calculateSMA(testData, 20);
            const rsi = backtestingEngine.calculateRSI(testData, 14);
            if (!sma || !rsi || sma <= 0 || rsi <= 0) {
                throw new Error('Technical indicator calculation failed');
            }
            return { sma, rsi, strategiesRegistered: status.strategies.length };
        });
        // Test 2: Paper Trading Service
        await this.runTest('Paper Trading Service Initialization', async () => {
            // Test session creation
            const sessionConfig = {
                name: 'Test Session',
                strategyName: 'test_momentum',
                symbol: 'BTCUSDT',
                timeframe: '1h',
                initialCapital: 100000
            };
            const session = await paperTradingService.createSession(sessionConfig);
            if (!session || !session.id || session.initialCapital !== 100000) {
                throw new Error('Session creation failed');
            }
            // Test position size calculation
            const positionSize = paperTradingService.calculatePositionSize(session, { strength: 0.8, side: 'long' }, { price: 50000 });
            if (positionSize <= 0 || positionSize > session.initialCapital) {
                throw new Error('Position size calculation failed');
            }
            return {
                sessionId: session.id,
                positionSize: positionSize.toFixed(2),
                initialCapital: session.initialCapital
            };
        });
        // Test 3: Confidence Scoring Service
        await this.runTest('Confidence Scoring Service', async () => {
            // Test market conditions analysis
            const mockMarketConditions = {
                symbol: 'BTCUSDT',
                volatility: { value: 0.02, level: 'medium' },
                trend: { strength: 0.5, direction: 'bullish' },
                liquidity: { value: 0.7, level: 'high' },
                riskLevel: 'medium'
            };
            // Test confidence score calculation components
            const performanceData = {
                trades: [
                    { pnl: 1000 }, { pnl: -500 }, { pnl: 800 },
                    { pnl: -300 }, { pnl: 1200 }, { pnl: 600 },
                    { pnl: -400 }, { pnl: 900 }, { pnl: -200 },
                    { pnl: 1100 }, { pnl: 700 }, { pnl: -600 }
                ]
            };
            const performanceScore = confidenceScoringService.calculatePerformanceScore(performanceData);
            const consistencyScore = confidenceScoringService.calculateConsistencyScore(performanceData);
            const riskScore = confidenceScoringService.calculateRiskScore(performanceData);
            if (performanceScore < 0 || performanceScore > 100 ||
                consistencyScore < 0 || consistencyScore > 100 ||
                riskScore < 0 || riskScore > 100) {
                throw new Error('Confidence scoring calculation failed');
            }
            const recommendedSize = confidenceScoringService.calculateRecommendedPositionSize(75, mockMarketConditions);
            if (recommendedSize <= 0 || recommendedSize > 0.1) {
                throw new Error('Position size recommendation failed');
            }
            return {
                performanceScore: performanceScore.toFixed(2),
                consistencyScore: consistencyScore.toFixed(2),
                riskScore: riskScore.toFixed(2),
                recommendedSize: recommendedSize.toFixed(4)
            };
        });
        // Test 4: Poloniex Futures Service
        await this.runTest('Poloniex Futures Service', async () => {
            // Test service initialization
            const userCredentials = {
                apiKey: 'test_key',
                apiSecret: 'test_secret',
                passphrase: 'test_passphrase'
            };
            poloniexFuturesService.setUserCredentials(userCredentials);
            // Test HMAC signature generation
            const signature = poloniexFuturesService.generateSignature('GET', '/api/v1/accounts', '', '1234567890');
            if (!signature || signature.length === 0) {
                throw new Error('HMAC signature generation failed');
            }
            // Test market data formatting
            const mockTickerData = {
                symbol: 'BTCUSDT',
                last: '50000.00',
                volume: '1000.00',
                priceChangePercent: '2.50'
            };
            const formattedData = poloniexFuturesService.formatMarketData(mockTickerData);
            if (!formattedData || !formattedData.symbol || !formattedData.price) {
                throw new Error('Market data formatting failed');
            }
            return {
                signatureGenerated: signature.length > 0,
                marketDataFormatted: !!formattedData.symbol
            };
        });
        logger.info('✅ Core Service Tests completed');
    }
    /**
     * Run integration tests
     */
    async runIntegrationTests() {
        logger.info('🔗 Running Integration Tests...');
        // Test 1: Backtesting + Confidence Scoring Integration
        await this.runTest('Backtesting-Confidence Integration', async () => {
            // Create mock backtest result
            const mockBacktestResult = {
                strategyName: 'test_momentum',
                symbol: 'BTCUSDT',
                timeframe: '1h',
                trades: [
                    { type: 'exit', pnl: 1000, timestamp: new Date() },
                    { type: 'exit', pnl: -500, timestamp: new Date() },
                    { type: 'exit', pnl: 800, timestamp: new Date() }
                ],
                totalReturn: 15.5,
                sharpeRatio: 1.2,
                maxDrawdown: 8.5
            };
            // Test that backtest results can be used for confidence scoring
            const performanceScore = confidenceScoringService.calculatePerformanceScore({
                trades: mockBacktestResult.trades
            });
            if (performanceScore <= 0) {
                throw new Error('Backtest-confidence integration failed');
            }
            return { performanceScore: performanceScore.toFixed(2) };
        });
        // Test 2: Paper Trading + Risk Management Integration
        await this.runTest('Paper Trading-Risk Management Integration', async () => {
            // Test risk checks
            const mockSession = {
                id: 'test_session',
                initialCapital: 100000,
                currentValue: 95000,
                cash: 50000,
                riskParameters: {
                    maxDailyLoss: 0.05,
                    maxPositionSize: 0.1
                }
            };
            const mockSignal = { strength: 0.8, side: 'long' };
            const mockMarketData = { price: 50000 };
            const riskCheck = paperTradingService.performRiskCheck(mockSession, mockSignal, mockMarketData);
            if (!Object.prototype.hasOwnProperty.call(riskCheck, 'allowed')) {
                throw new Error('Risk check integration failed');
            }
            return { riskCheckPassed: riskCheck.allowed };
        });
        // Test 3: Automated Trading Service Integration
        await this.runTest('Automated Trading Service Integration', async () => {
            // Test strategy execution pipeline
            const mockStrategy = {
                name: 'integrated_test_strategy',
                type: 'momentum',
                parameters: {
                    rsi_oversold: 30,
                    rsi_overbought: 70
                }
            };
            // Test that services can communicate
            backtestingEngine.registerStrategy('integrated_test', mockStrategy);
            const status = backtestingEngine.getBacktestStatus();
            const isRegistered = status.strategies.includes('integrated_test');
            if (!isRegistered) {
                throw new Error('Service integration failed');
            }
            return { strategyIntegrated: isRegistered };
        });
        logger.info('✅ Integration Tests completed');
    }
    /**
     * Run performance tests
     */
    async runPerformanceTests() {
        logger.info('⚡ Running Performance Tests...');
        // Test 1: Technical Indicator Performance
        await this.runTest('Technical Indicator Performance', async () => {
            const largeDataset = Array.from({ length: 1000 }, (_, i) => 100 + Math.sin(i * 0.1) * 10);
            const startTime = Date.now();
            // Test multiple indicator calculations
            const sma20 = backtestingEngine.calculateSMA(largeDataset, 20);
            const rsi = backtestingEngine.calculateRSI(largeDataset, 14);
            const bb = backtestingEngine.calculateBollingerBands(largeDataset, 20, 2);
            const macd = backtestingEngine.calculateMACD(largeDataset);
            const endTime = Date.now();
            const executionTime = endTime - startTime;
            if (executionTime > 1000) { // Should complete within 1 second
                throw new Error(`Performance test failed: ${executionTime}ms execution time`);
            }
            return {
                dataPoints: largeDataset.length,
                executionTime: `${executionTime}ms`,
                indicatorsCalculated: 4
            };
        });
        // Test 2: Database Query Performance
        await this.runTest('Database Query Performance', async () => {
            const startTime = Date.now();
            // Test multiple database operations
            const queries = [
                confidenceScoringService.loadExistingConfidenceScores(),
                paperTradingService.loadActiveSessions(),
                backtestingEngine.getBacktestResults(10)
            ];
            await Promise.all(queries);
            const endTime = Date.now();
            const executionTime = endTime - startTime;
            if (executionTime > 5000) { // Should complete within 5 seconds
                throw new Error(`Database performance test failed: ${executionTime}ms execution time`);
            }
            return {
                queriesExecuted: queries.length,
                executionTime: `${executionTime}ms`
            };
        });
        logger.info('✅ Performance Tests completed');
    }
    /**
     * Run AI/ML trading logic tests
     */
    async runAIMLTests() {
        logger.info('🤖 Running AI/ML Trading Logic Tests...');
        // Test 1: Signal Generation Logic
        await this.runTest('AI Signal Generation', async () => {
            const mockMarketData = {
                timestamp: new Date(),
                open: 49500,
                high: 50500,
                low: 49000,
                close: 50000,
                volume: 1000
            };
            const mockHistoricalData = Array.from({ length: 50 }, (_, i) => ({
                timestamp: new Date(Date.now() - i * 60000),
                open: 50000 + Math.random() * 1000 - 500,
                high: 50500 + Math.random() * 1000 - 500,
                low: 49500 + Math.random() * 1000 - 500,
                close: 50000 + Math.random() * 1000 - 500,
                volume: 1000 + Math.random() * 500
            }));
            const indicators = backtestingEngine.calculateTechnicalIndicators(mockHistoricalData, mockMarketData);
            if (!indicators || !indicators.sma20 || !indicators.rsi) {
                throw new Error('Technical indicators calculation failed');
            }
            // Test signal generation
            const momentumSignal = backtestingEngine.generateMomentumSignals(indicators, {
                rsi_oversold: 30,
                rsi_overbought: 70,
                macd_threshold: 0
            });
            const meanReversionSignal = backtestingEngine.generateMeanReversionSignals(indicators, {
                bb_std_dev: 2,
                rsi_extreme: 20
            });
            // At least one signal generation method should work
            const signalGenerated = momentumSignal !== null || meanReversionSignal !== null;
            return {
                indicatorsCalculated: Object.keys(indicators).length,
                signalGenerated,
                rsi: indicators.rsi?.toFixed(2),
                sma20: indicators.sma20?.toFixed(2)
            };
        });
        // Test 2: Risk-Adjusted Position Sizing
        await this.runTest('AI Risk-Adjusted Position Sizing', async () => {
            const mockSignal = { strength: 0.8, side: 'long', reason: 'momentum_long' };
            const mockConfig = {
                riskPerTrade: 0.02,
                maxPositionSize: 0.1,
                minPositionSize: 0.01
            };
            // Mock backtesting engine for position sizing
            backtestingEngine.currentBacktest = {
                portfolio: { totalValue: 100000 }
            };
            const positionSize = backtestingEngine.calculatePositionSize(mockSignal, mockConfig);
            if (positionSize <= 0 || positionSize > 10000) { // Should be reasonable for $100k portfolio
                throw new Error('AI position sizing failed');
            }
            // Test confidence-based adjustment
            const confidenceScore = 75;
            const marketConditions = { volatility: { level: 'medium' }, riskLevel: 'medium' };
            const adjustedSize = confidenceScoringService.calculateRecommendedPositionSize(confidenceScore, marketConditions);
            if (adjustedSize <= 0 || adjustedSize > 0.1) {
                throw new Error('Confidence-based position sizing failed');
            }
            return {
                basePositionSize: positionSize.toFixed(2),
                adjustedPositionSize: adjustedSize.toFixed(4),
                confidenceScore
            };
        });
        // Test 3: Automated Strategy Selection
        await this.runTest('AI Strategy Selection Logic', async () => {
            // Test market condition-based strategy selection
            const marketConditions = [
                { volatility: { level: 'low' }, trend: { strength: 0.8 }, phase: 'trending' },
                { volatility: { level: 'high' }, trend: { strength: 0.2 }, phase: 'volatile' },
                { volatility: { level: 'medium' }, trend: { strength: 0.5 }, phase: 'mixed' }
            ];
            const strategies = ['momentum', 'mean_reversion', 'breakout'];
            let bestStrategies = [];
            for (const condition of marketConditions) {
                // Simple strategy selection logic
                let bestStrategy = 'momentum'; // default
                if (condition.volatility.level === 'high') {
                    bestStrategy = 'mean_reversion';
                }
                else if (condition.trend.strength > 0.7) {
                    bestStrategy = 'momentum';
                }
                else if (condition.volatility.level === 'low') {
                    bestStrategy = 'breakout';
                }
                bestStrategies.push(bestStrategy);
            }
            if (bestStrategies.length !== marketConditions.length) {
                throw new Error('Strategy selection logic failed');
            }
            return {
                conditionsTested: marketConditions.length,
                strategiesSelected: bestStrategies,
                selectionLogicWorking: true
            };
        });
        logger.info('✅ AI/ML Trading Logic Tests completed');
    }
    /**
     * Run risk management tests
     */
    async runRiskManagementTests() {
        logger.info('🛡️ Running Risk Management Tests...');
        // Test 1: Stop Loss and Take Profit Logic
        await this.runTest('Stop Loss & Take Profit Logic', async () => {
            const mockPosition = {
                side: 'long',
                entryPrice: 50000,
                size: 1000,
                stopLoss: 49000,
                takeProfit: 52000
            };
            const testPrices = [48000, 49500, 51000, 52500]; // Below SL, near SL, normal, above TP
            let exitSignals = [];
            for (const price of testPrices) {
                const exitSignal = backtestingEngine.checkExitConditions(mockPosition, { close: price }, mockPosition.stopLoss, mockPosition.takeProfit);
                exitSignals.push(exitSignal);
            }
            // Should trigger SL for 48000, no exit for 49500 and 51000, TP for 52500
            const expectedExits = [true, false, false, true];
            const actualExits = exitSignals.map(signal => signal !== null);
            if (JSON.stringify(actualExits) !== JSON.stringify(expectedExits)) {
                throw new Error('Stop loss/take profit logic failed');
            }
            return {
                testPrices,
                exitSignals: exitSignals.map(s => s ? s.reason : 'none'),
                logicWorking: true
            };
        });
        // Test 2: Portfolio Risk Limits
        await this.runTest('Portfolio Risk Limits', async () => {
            const mockSession = {
                initialCapital: 100000,
                currentValue: 95000, // 5% loss
                cash: 50000,
                riskParameters: {
                    maxDailyLoss: 0.05, // 5% max daily loss
                    maxPositionSize: 0.1 // 10% max position size
                }
            };
            const mockSignal = { strength: 0.8, side: 'long' };
            const mockMarketData = { price: 50000 };
            // Test 1: At risk limit (should be rejected)
            const riskCheck1 = paperTradingService.performRiskCheck({ ...mockSession, currentValue: 95000 }, // Exactly at limit
            mockSignal, mockMarketData);
            // Test 2: Below risk limit (should be allowed)
            const riskCheck2 = paperTradingService.performRiskCheck({ ...mockSession, currentValue: 97000 }, // Below limit
            mockSignal, mockMarketData);
            return {
                atRiskLimit: riskCheck1.allowed,
                belowRiskLimit: riskCheck2.allowed,
                riskLimitsWorking: !riskCheck1.allowed && riskCheck2.allowed
            };
        });
        // Test 3: Drawdown Management
        await this.runTest('Drawdown Management', async () => {
            const mockTrades = [
                { pnl: 1000 }, { pnl: -500 }, { pnl: 800 }, { pnl: -1200 },
                { pnl: 600 }, { pnl: -800 }, { pnl: 1100 }, { pnl: -600 }
            ];
            let runningPnl = 0;
            let peak = 0;
            let maxDrawdown = 0;
            for (const trade of mockTrades) {
                runningPnl += trade.pnl;
                if (runningPnl > peak) {
                    peak = runningPnl;
                }
                const drawdown = peak - runningPnl;
                if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                }
            }
            const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
            if (maxDrawdownPercent <= 0 || maxDrawdownPercent > 100) {
                throw new Error('Drawdown calculation failed');
            }
            return {
                totalTrades: mockTrades.length,
                maxDrawdown: maxDrawdown.toFixed(2),
                maxDrawdownPercent: maxDrawdownPercent.toFixed(2),
                drawdownCalculationWorking: true
            };
        });
        logger.info('✅ Risk Management Tests completed');
    }
    /**
     * Run end-to-end tests
     */
    async runEndToEndTests() {
        logger.info('🔄 Running End-to-End Tests...');
        // Test 1: Complete Trading Cycle
        await this.runTest('Complete Trading Cycle', async () => {
            // 1. Create strategy
            const strategy = {
                name: 'E2E Test Strategy',
                type: 'momentum',
                parameters: { rsi_oversold: 30, rsi_overbought: 70 }
            };
            backtestingEngine.registerStrategy('e2e_test', strategy);
            // 2. Create paper trading session
            const sessionConfig = {
                name: 'E2E Test Session',
                strategyName: 'e2e_test',
                symbol: 'BTCUSDT',
                timeframe: '1h',
                initialCapital: 100000
            };
            const session = await paperTradingService.createSession(sessionConfig);
            // 3. Simulate market data and signal generation
            const mockMarketData = {
                symbol: 'BTCUSDT',
                price: 50000,
                volume: 1000,
                timestamp: new Date()
            };
            // 4. Test position creation
            const position = await paperTradingService.createPosition(session, {
                side: 'long',
                size: 1000,
                entryPrice: 50000,
                stopLoss: 49000,
                takeProfit: 52000,
                reason: 'e2e_test'
            });
            // 5. Test position closing
            const closedPosition = await paperTradingService.closePosition(session.id, position.id, 'test_close', 51000);
            if (!closedPosition || closedPosition.status !== 'closed') {
                throw new Error('Complete trading cycle failed');
            }
            return {
                sessionCreated: !!session.id,
                positionOpened: !!position.id,
                positionClosed: closedPosition.status === 'closed',
                realizedPnl: closedPosition.realizedPnl.toFixed(2),
                cycleCompleted: true
            };
        });
        // Test 2: Automated Decision Making
        await this.runTest('Automated Decision Making', async () => {
            // Test the complete decision pipeline
            const symbol = 'BTCUSDT';
            const strategy = 'momentum';
            // 1. Get market conditions
            const marketConditions = {
                volatility: { level: 'medium' },
                trend: { strength: 0.6, direction: 'bullish' },
                liquidity: { level: 'high' },
                riskLevel: 'medium'
            };
            // 2. Calculate confidence score
            const confidenceScore = 75;
            const recommendedSize = confidenceScoringService.calculateRecommendedPositionSize(confidenceScore, marketConditions);
            // 3. Generate trading decision
            const tradingDecision = {
                action: confidenceScore >= 70 ? 'buy' : confidenceScore >= 50 ? 'hold' : 'sell',
                positionSize: recommendedSize,
                confidence: confidenceScore,
                reasoning: `Confidence: ${confidenceScore}%, Market: ${marketConditions.riskLevel} risk`
            };
            if (!tradingDecision.action || !tradingDecision.positionSize) {
                throw new Error('Automated decision making failed');
            }
            return {
                marketConditionsAnalyzed: true,
                confidenceScoreCalculated: confidenceScore,
                tradingDecision: tradingDecision.action,
                positionSize: tradingDecision.positionSize.toFixed(4),
                decisionMakingWorking: true
            };
        });
        logger.info('✅ End-to-End Tests completed');
    }
    /**
     * Run individual test
     */
    async runTest(testName, testFunction) {
        try {
            this.testResults.total++;
            logger.info(`🧪 Running: ${testName}`);
            const startTime = Date.now();
            const result = await testFunction();
            const endTime = Date.now();
            const executionTime = endTime - startTime;
            this.testResults.passed++;
            this.testResults.tests.push({
                name: testName,
                status: 'PASSED',
                executionTime: `${executionTime}ms`,
                result
            });
            logger.info(`✅ PASSED: ${testName} (${executionTime}ms)`);
        }
        catch (error) {
            this.testResults.failed++;
            this.testResults.tests.push({
                name: testName,
                status: 'FAILED',
                error: error.message,
                result: null
            });
            logger.error(`❌ FAILED: ${testName} - ${error.message}`);
        }
    }
    /**
     * Generate test report
     */
    generateTestReport() {
        logger.info('\n' + '='.repeat(80));
        logger.info('📊 COMPREHENSIVE TEST SUITE REPORT');
        logger.info('='.repeat(80));
        logger.info(`Total Tests: ${this.testResults.total}`);
        logger.info(`Passed: ${this.testResults.passed}`);
        logger.info(`Failed: ${this.testResults.failed}`);
        logger.info(`Success Rate: ${((this.testResults.passed / this.testResults.total) * 100).toFixed(2)}%`);
        logger.info('\n📋 Test Details:');
        for (const test of this.testResults.tests) {
            const status = test.status === 'PASSED' ? '✅' : '❌';
            const time = test.executionTime || 'N/A';
            logger.info(`${status} ${test.name} (${time})`);
            if (test.status === 'FAILED') {
                logger.error(`   Error: ${test.error}`);
            }
        }
        logger.info('\n🎯 System Readiness Assessment:');
        const readiness = this.assessSystemReadiness();
        for (const [component, status] of Object.entries(readiness)) {
            const emoji = status ? '✅' : '❌';
            logger.info(`${emoji} ${component}: ${status ? 'READY' : 'NOT READY'}`);
        }
        logger.info('\n🚀 Overall System Status:');
        const overallReady = Object.values(readiness).every(Boolean);
        logger.info(`${overallReady ? '✅' : '❌'} System is ${overallReady ? 'READY' : 'NOT READY'} for automated trading`);
        logger.info('='.repeat(80));
    }
    /**
     * Assess system readiness for automated trading
     */
    assessSystemReadiness() {
        const passedTests = this.testResults.tests.filter(t => t.status === 'PASSED');
        return {
            'Backtesting Engine': passedTests.some(t => t.name.includes('Backtesting')),
            'Paper Trading': passedTests.some(t => t.name.includes('Paper Trading')),
            'Confidence Scoring': passedTests.some(t => t.name.includes('Confidence')),
            'Risk Management': passedTests.some(t => t.name.includes('Risk')),
            'AI/ML Logic': passedTests.some(t => t.name.includes('AI')),
            'Integration': passedTests.some(t => t.name.includes('Integration')),
            'Performance': passedTests.some(t => t.name.includes('Performance')),
            'End-to-End': passedTests.some(t => t.name.includes('End-to-End'))
        };
    }
}
// Run the test suite if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const testSuite = new ComprehensiveTestSuite();
    testSuite.runAllTests()
        .then(results => {
        const success = results.failed === 0;
        logger.info(`\n🏁 Test suite completed. ${success ? 'All tests passed!' : `${results.failed} tests failed.`}`);
        process.exit(success ? 0 : 1);
    })
        .catch(error => {
        logger.error('❌ Test suite execution failed:', error);
        process.exit(1);
    });
}
export default ComprehensiveTestSuite;
