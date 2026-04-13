#!/usr/bin/env node

import { logger } from '../utils/logger.js';
import { strategyLearningEngine } from '../services/strategyLearningEngine.js';
import profitBankingService from '../services/profitBankingService.js';

/**
 * Test Suite for Autonomous Trading System
 * Tests the core autonomous trading functionality via SLE (Strategy Learning Engine)
 * 
 * NOTE: autonomousStrategyGenerator and strategyOptimizer have been deprecated.
 * Strategy generation is now handled entirely by strategyLearningEngine (SLE).
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

      // Test 1: SLE Engine Status
      await this.runTest('Strategy Learning Engine Status', async () => {
        const status = await strategyLearningEngine.getEngineStatus();
        
        if (status.isRunning === undefined) {
          throw new Error('Engine status missing isRunning field');
        }
        
        return {
          isRunning: status.isRunning,
          generationCount: status.generationCount,
          activeStrategies: status.activeStrategies
        };
      });

      // Test 2: SLE Top Performers Query
      await this.runTest('SLE Top Performers', async () => {
        const performers = await strategyLearningEngine.getTopPerformers(10);
        
        return {
          performerCount: performers.length,
          hasResults: performers.length >= 0
        };
      });

      // Test 3: SLE Live Recommendations Query
      await this.runTest('SLE Live Recommendations', async () => {
        const recommended = await strategyLearningEngine.getLiveRecommendations();
        
        return {
          recommendedCount: recommended.length,
          hasResults: recommended.length >= 0
        };
      });

      // Test 4: Profit Banking Configuration
      await this.runTest('Profit Banking Configuration', async () => {
        const originalConfig = { ...profitBankingService.bankingConfig };
        
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

      // Test 5: Emergency Stop Simulation
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

      // Test 6: System Integration
      await this.runTest('System Integration', async () => {
        const sleStatus = await strategyLearningEngine.getEngineStatus();
        const systemStatus = {
          sleAvailable: sleStatus !== null && sleStatus !== undefined,
          profitBankingConfigured: profitBankingService.bankingConfig.enabled,
        };
        
        return {
          systemStatus,
          allSystemsReady: Object.values(systemStatus).every(Boolean)
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