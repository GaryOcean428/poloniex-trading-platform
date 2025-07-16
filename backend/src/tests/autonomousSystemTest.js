#!/usr/bin/env node

import { logger } from '../utils/logger.js';
import autonomousStrategyGenerator from '../services/autonomousStrategyGenerator.js';
import strategyOptimizer from '../services/strategyOptimizer.js';
import profitBankingService from '../services/profitBankingService.js';

/**
 * Test Suite for Autonomous Trading System
 * Tests the core autonomous trading functionality
 */
class AutonomousSystemTest {
  constructor() {
    this.testResults = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runAllTests() {
    try {
      logger.info('🧠 Starting Autonomous Trading System Tests...');
      logger.info('=' .repeat(80));

      // Test 1: Strategy Generator Initialization
      await this.runTest('Autonomous Strategy Generator Initialization', async () => {
        // Test initialization
        await autonomousStrategyGenerator.initialize();
        
        if (autonomousStrategyGenerator.strategies.size === 0) {
          throw new Error('No strategies created during initialization');
        }
        
        return {
          strategiesCreated: autonomousStrategyGenerator.strategies.size,
          generationCount: autonomousStrategyGenerator.generationCount
        };
      });

      // Test 2: Strategy Generation
      await this.runTest('Strategy Generation', async () => {
        const symbols = ['BTCUSDT', 'ETHUSDT'];
        const strategyTypes = ['momentum', 'mean_reversion'];
        
        const strategy = autonomousStrategyGenerator.generateRandomStrategy(symbols, strategyTypes);
        
        if (!strategy.id || !strategy.name || !strategy.type) {
          throw new Error('Generated strategy missing required fields');
        }
        
        if (!strategy.parameters || !strategy.indicators) {
          throw new Error('Generated strategy missing parameters or indicators');
        }
        
        return {
          strategyId: strategy.id,
          strategyType: strategy.type,
          symbol: strategy.symbol,
          indicatorCount: strategy.indicators.length,
          parameterCount: Object.keys(strategy.parameters).length
        };
      });

      // Test 3: Strategy Mutation
      await this.runTest('Strategy Mutation', async () => {
        const parentStrategy = {
          id: 'parent_test',
          name: 'Test Parent Strategy',
          type: 'momentum',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          indicators: [{ category: 'momentum', indicator: 'RSI' }],
          parameters: {
            rsi_oversold: 30,
            rsi_overbought: 70,
            stopLoss: 0.02,
            takeProfit: 0.04
          },
          performance: {
            profit: 0.1,
            winRate: 0.65
          }
        };
        
        const mutatedStrategy = autonomousStrategyGenerator.mutateStrategy(parentStrategy);
        
        if (!mutatedStrategy.id || mutatedStrategy.id === parentStrategy.id) {
          throw new Error('Mutated strategy missing or invalid ID');
        }
        
        if (!mutatedStrategy.parent || mutatedStrategy.parent !== parentStrategy.id) {
          throw new Error('Mutated strategy missing parent reference');
        }
        
        return {
          parentId: parentStrategy.id,
          mutatedId: mutatedStrategy.id,
          parametersDifferent: JSON.stringify(mutatedStrategy.parameters) !== JSON.stringify(parentStrategy.parameters)
        };
      });

      // Test 4: Strategy Crossover
      await this.runTest('Strategy Crossover', async () => {
        const parent1 = {
          id: 'parent1_test',
          name: 'Test Parent 1',
          type: 'momentum',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          indicators: [{ category: 'momentum', indicator: 'RSI' }],
          parameters: { rsi_oversold: 30, stopLoss: 0.02 }
        };
        
        const parent2 = {
          id: 'parent2_test',
          name: 'Test Parent 2',
          type: 'mean_reversion',
          symbol: 'ETHUSDT',
          timeframe: '4h',
          indicators: [{ category: 'volatility', indicator: 'Bollinger_Bands' }],
          parameters: { bb_std_dev: 2.0, stopLoss: 0.03 }
        };
        
        const offspring = autonomousStrategyGenerator.crossoverStrategies(parent1, parent2);
        
        if (!offspring.id || !offspring.parents) {
          throw new Error('Crossover offspring missing required fields');
        }
        
        if (offspring.parents.length !== 2) {
          throw new Error('Crossover offspring should have exactly 2 parents');
        }
        
        return {
          offspringId: offspring.id,
          parents: offspring.parents,
          inheritedType: offspring.type,
          inheritedSymbol: offspring.symbol
        };
      });

      // Test 5: Fitness Score Calculation
      await this.runTest('Fitness Score Calculation', async () => {
        const testStrategy = {
          performance: {
            profit: 0.15,
            winRate: 0.70,
            sharpeRatio: 1.2,
            maxDrawdown: 0.08,
            confidence: 75
          }
        };
        
        const fitnessScore = autonomousStrategyGenerator.calculateFitnessScore(testStrategy);
        
        if (fitnessScore <= 0) {
          throw new Error('Fitness score should be positive for profitable strategy');
        }
        
        return {
          profit: testStrategy.performance.profit,
          winRate: testStrategy.performance.winRate,
          fitnessScore: fitnessScore.toFixed(4)
        };
      });

      // Test 6: Strategy Optimizer Queue
      await this.runTest('Strategy Optimizer Queue', async () => {
        const mockStrategy = {
          id: 'queue_test_strategy',
          name: 'Queue Test Strategy',
          type: 'momentum',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          parameters: { rsi_oversold: 30, rsi_overbought: 70 }
        };
        
        // Test backtest queue
        await strategyOptimizer.queueForBacktest(mockStrategy);
        
        if (strategyOptimizer.backtestQueue.length === 0) {
          throw new Error('Strategy not added to backtest queue');
        }
        
        return {
          strategyId: mockStrategy.id,
          queuedForBacktest: true,
          backtestQueueSize: strategyOptimizer.backtestQueue.length
        };
      });

      // Test 7: Profit Banking Configuration
      await this.runTest('Profit Banking Configuration', async () => {
        const originalConfig = { ...profitBankingService.bankingConfig };
        
        // Test config update
        const newConfig = {
          bankingPercentage: 0.25,
          minimumProfitThreshold: 75
        };
        
        profitBankingService.updateConfig(newConfig);
        
        if (profitBankingService.bankingConfig.bankingPercentage !== 0.25) {
          throw new Error('Banking percentage not updated correctly');
        }
        
        if (profitBankingService.bankingConfig.minimumProfitThreshold !== 75) {
          throw new Error('Minimum profit threshold not updated correctly');
        }
        
        // Restore original config
        profitBankingService.updateConfig(originalConfig);
        
        return {
          configUpdated: true,
          newBankingPercentage: newConfig.bankingPercentage,
          newMinimumThreshold: newConfig.minimumProfitThreshold
        };
      });

      // Test 8: Emergency Stop Simulation
      await this.runTest('Emergency Stop Simulation', async () => {
        const initialBalance = 10000;
        const currentBalance = 7000; // 30% drawdown
        
        const emergencyStop = await profitBankingService.checkEmergencyStop(currentBalance);
        
        if (!emergencyStop) {
          throw new Error('Emergency stop should trigger with 30% drawdown');
        }
        
        return {
          initialBalance,
          currentBalance,
          drawdown: ((initialBalance - currentBalance) / initialBalance * 100).toFixed(2) + '%',
          emergencyStopTriggered: emergencyStop
        };
      });

      // Test 9: Risk Tolerance Configuration
      await this.runTest('Risk Tolerance Configuration', async () => {
        const originalRiskTolerance = { ...autonomousStrategyGenerator.riskTolerance };
        
        const newRiskTolerance = {
          maxDrawdown: 0.12,
          riskPerTrade: 0.015,
          profitBankingPercent: 0.25
        };
        
        autonomousStrategyGenerator.riskTolerance = {
          ...autonomousStrategyGenerator.riskTolerance,
          ...newRiskTolerance
        };
        
        if (autonomousStrategyGenerator.riskTolerance.maxDrawdown !== 0.12) {
          throw new Error('Max drawdown not updated correctly');
        }
        
        // Restore original
        autonomousStrategyGenerator.riskTolerance = originalRiskTolerance;
        
        return {
          riskToleranceUpdated: true,
          newMaxDrawdown: newRiskTolerance.maxDrawdown,
          newRiskPerTrade: newRiskTolerance.riskPerTrade
        };
      });

      // Test 10: System Integration
      await this.runTest('System Integration', async () => {
        // Test that all components can work together
        const systemStatus = {
          strategyGeneratorInitialized: autonomousStrategyGenerator.strategies.size > 0,
          profitBankingConfigured: profitBankingService.bankingConfig.enabled,
          optimizerReady: strategyOptimizer.thresholds.backtestMinProfit > 0,
          riskToleranceSet: autonomousStrategyGenerator.riskTolerance.maxDrawdown > 0
        };
        
        const allSystemsReady = Object.values(systemStatus).every(Boolean);
        
        if (!allSystemsReady) {
          throw new Error('Not all system components are ready');
        }
        
        return {
          systemStatus,
          allSystemsReady,
          totalStrategies: autonomousStrategyGenerator.strategies.size
        };
      });

      // Generate test report
      this.generateTestReport();

      return this.testResults;
    } catch (error) {
      logger.error('❌ Test suite execution failed:', error);
      throw error;
    }
  }

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
    } catch (error) {
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

  generateTestReport() {
    logger.info('\n' + '='.repeat(80));
    logger.info('🧠 AUTONOMOUS TRADING SYSTEM TEST REPORT');
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

    logger.info('\n🚀 System Readiness Assessment:');
    const readiness = this.assessSystemReadiness();
    for (const [component, status] of Object.entries(readiness)) {
      const emoji = status ? '✅' : '❌';
      logger.info(`${emoji} ${component}: ${status ? 'READY' : 'NOT READY'}`);
    }

    logger.info('\n🎯 Overall System Status:');
    const overallReady = Object.values(readiness).every(Boolean);
    logger.info(`${overallReady ? '✅' : '❌'} Autonomous Trading System is ${overallReady ? 'READY' : 'NOT READY'}`);

    logger.info('='.repeat(80));
  }

  assessSystemReadiness() {
    const passedTests = this.testResults.tests.filter(t => t.status === 'PASSED');
    
    return {
      'Strategy Generation': passedTests.some(t => t.name.includes('Strategy Generation')),
      'Strategy Evolution': passedTests.some(t => t.name.includes('Mutation') || t.name.includes('Crossover')),
      'Fitness Calculation': passedTests.some(t => t.name.includes('Fitness')),
      'Profit Banking': passedTests.some(t => t.name.includes('Banking')),
      'Risk Management': passedTests.some(t => t.name.includes('Risk') || t.name.includes('Emergency')),
      'System Integration': passedTests.some(t => t.name.includes('Integration'))
    };
  }
}

// Run the test suite if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new AutonomousSystemTest();
  testSuite.runAllTests()
    .then(results => {
      const success = results.failed === 0;
      logger.info(`\n🏁 Autonomous system test completed. ${success ? 'All tests passed!' : `${results.failed} tests failed.`}`);
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      logger.error('❌ Test suite execution failed:', error);
      process.exit(1);
    });
}

export default AutonomousSystemTest;