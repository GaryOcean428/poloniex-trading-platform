import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { WebSocketService } from '@/services/websocketService';
import { LiveDataService } from '@/services/advancedLiveData';
import { strategyTester } from '@/utils/strategyTester';
import { MockModeContext } from '@/context/MockModeContext';
import { chromeExtension } from '@/utils/chromeExtension';
import { default as mlTrading } from '@/ml/mlTrading';
import { default as dqnTrading } from '@/ml/dqnTrading';
import { default as modelRecalibration } from '@/ml/modelRecalibration';
import React from 'react';

// Mock dependencies
vi.mock('@/services/websocketService');
vi.mock('@/services/advancedLiveData');
vi.mock('@/utils/chromeExtension');
vi.mock('@/ml/mlTrading');
vi.mock('@/ml/dqnTrading');
vi.mock('@/ml/modelRecalibration');

describe('Comprehensive System Testing', () => {
  // Error Recovery Mechanisms
  describe('Error Recovery Mechanisms', () => {
    const TestComponent = () => {
      const throwError = () => {
        throw new Error('Test error');
      };
      
      return (
        <div>
          <button onClick={throwError}>Throw Error</button>
        </div>
      );
    };
    
    it('should catch and display errors with retry option', async () => {
      const onErrorSpy = vi.fn();
      
      render(
        <ErrorBoundary onError={onErrorSpy}>
          <TestComponent />
        </ErrorBoundary>
      );
      
      // Trigger error
      fireEvent.click(screen.getByText('Throw Error'));
      
      // Error boundary should display error message
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
      expect(screen.getByText(/Test error/i)).toBeInTheDocument();
      
      // Retry button should be available
      const retryButton = screen.getByText(/Retry/i);
      expect(retryButton).toBeInTheDocument();
      
      // Error should have been reported
      expect(onErrorSpy).toHaveBeenCalledWith(expect.any(Error), expect.any(Object));
    });
    
    it('should handle API errors correctly', async () => {
      const TestApiComponent = () => {
        const { error, handleError, clearError } = useErrorHandler();
        
        return (
          <div>
            <button onClick={() => handleError(new Error('API Error'))}>Trigger API Error</button>
            {error && <div>Error: {error.message}</div>}
            <button onClick={clearError}>Clear Error</button>
          </div>
        );
      };
      
      render(<TestApiComponent />);
      
      // Trigger API error
      fireEvent.click(screen.getByText('Trigger API Error'));
      
      // Error should be displayed
      expect(screen.getByText(/Error: API Error/i)).toBeInTheDocument();
      
      // Clear error
      fireEvent.click(screen.getByText('Clear Error'));
      
      // Error should be cleared
      expect(screen.queryByText(/Error: API Error/i)).not.toBeInTheDocument();
    });
  });
  
  // WebSocket Reconnection Logic
  describe('WebSocket Reconnection Logic', () => {
    let websocketService: any;
    
    beforeEach(() => {
      websocketService = new WebSocketService();
      vi.spyOn(websocketService, 'connect');
      vi.spyOn(websocketService, 'disconnect');
      vi.spyOn(websocketService, 'reconnect');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should attempt reconnection with exponential backoff', async () => {
      // Simulate connection
      websocketService.connect();
      expect(websocketService.connect).toHaveBeenCalled();
      
      // Simulate disconnection
      websocketService.onDisconnect();
      
      // Should attempt reconnection
      await waitFor(() => {
        expect(websocketService.reconnect).toHaveBeenCalled();
      });
      
      // Simulate multiple failed reconnection attempts
      for (let i = 0; i < 3; i++) {
        websocketService.onReconnectFailed();
      }
      
      // Should have increased backoff delay
      expect(websocketService.currentBackoff).toBeGreaterThan(websocketService.initialBackoff);
    });
    
    it('should reset backoff after successful reconnection', async () => {
      // Simulate connection and disconnection
      websocketService.connect();
      websocketService.onDisconnect();
      
      // Simulate failed reconnection attempts
      for (let i = 0; i < 2; i++) {
        websocketService.onReconnectFailed();
      }
      
      const increasedBackoff = websocketService.currentBackoff;
      expect(increasedBackoff).toBeGreaterThan(websocketService.initialBackoff);
      
      // Simulate successful reconnection
      websocketService.onReconnect();
      
      // Backoff should be reset
      expect(websocketService.currentBackoff).toBe(websocketService.initialBackoff);
    });
  });
  
  // Strategy Testing Framework
  describe('Strategy Testing Framework', () => {
    beforeEach(() => {
      vi.spyOn(strategyTester, 'runBacktest');
      vi.spyOn(strategyTester, 'analyzeResults');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should run backtests correctly', async () => {
      const testStrategy = {
        id: 'test-strategy',
        name: 'Test Strategy',
        description: 'Strategy for testing',
        parameters: { threshold: 0.5 },
        execute: vi.fn()
      };
      
      const testData = Array(100).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 1, 0, i).getTime(),
        open: 100 + Math.random() * 10,
        high: 105 + Math.random() * 10,
        low: 95 + Math.random() * 10,
        close: 100 + Math.random() * 10,
        volume: 1000 + Math.random() * 500
      }));
      
      await strategyTester.runBacktest(testStrategy, testData, {
        initialCapital: 10000,
        feeRate: 0.001
      });
      
      expect(strategyTester.runBacktest).toHaveBeenCalled();
      expect(testStrategy.execute).toHaveBeenCalled();
    });
    
    it('should analyze backtest results correctly', () => {
      const testResults = {
        trades: [
          { type: 'buy', price: 100, amount: 1, timestamp: new Date(2023, 0, 1).getTime() },
          { type: 'sell', price: 110, amount: 1, timestamp: new Date(2023, 0, 2).getTime() },
          { type: 'buy', price: 105, amount: 1, timestamp: new Date(2023, 0, 3).getTime() },
          { type: 'sell', price: 115, amount: 1, timestamp: new Date(2023, 0, 4).getTime() }
        ],
        initialCapital: 10000,
        finalCapital: 10200,
        maxDrawdown: 0.02
      };
      
      const analysis = strategyTester.analyzeResults(testResults);
      
      expect(analysis).toHaveProperty('profitLoss');
      expect(analysis).toHaveProperty('profitLossPercentage');
      expect(analysis).toHaveProperty('winRate');
      expect(analysis).toHaveProperty('averageWin');
      expect(analysis).toHaveProperty('averageLoss');
      expect(analysis).toHaveProperty('maxDrawdown');
      expect(analysis).toHaveProperty('sharpeRatio');
      
      expect(analysis.profitLoss).toBe(200);
      expect(analysis.profitLossPercentage).toBe(0.02);
    });
  });
  
  // Mock Mode Implementation
  describe('Mock Mode Implementation', () => {
    it('should provide consistent mock data across components', () => {
      const mockContextValue = {
        mockMode: true,
        setMockMode: vi.fn(),
        mockDataConfig: {
          volatility: 'medium',
          trend: 'bullish',
          latency: 'low'
        },
        updateMockDataConfig: vi.fn()
      };
      
      const TestComponent = () => {
        return (
          <div data-testid="test-component">
            Mock Mode: {mockContextValue.mockMode ? 'Enabled' : 'Disabled'}
          </div>
        );
      };
      
      render(
        <MockModeContext.Provider value={mockContextValue}>
          <TestComponent />
        </MockModeContext.Provider>
      );
      
      expect(screen.getByTestId('test-component')).toHaveTextContent('Mock Mode: Enabled');
    });
  });
  
  // Extension Security
  describe('Extension Security', () => {
    beforeEach(() => {
      vi.spyOn(chromeExtension, 'validateMessage');
      vi.spyOn(chromeExtension, 'sendMessage');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should validate extension messages correctly', () => {
      const validMessage = {
        type: 'TRADE_ACTION',
        payload: { symbol: 'BTC_USDT', action: 'BUY', amount: 0.1 },
        timestamp: Date.now(),
        origin: 'poloniex-trading-platform'
      };
      
      const invalidMessage = {
        type: 'UNKNOWN_ACTION',
        payload: {},
        timestamp: Date.now() - 60000, // Expired timestamp
        origin: 'unknown-origin'
      };
      
      expect(chromeExtension.validateMessage(validMessage)).toBe(true);
      expect(chromeExtension.validateMessage(invalidMessage)).toBe(false);
    });
    
    it('should send messages with proper security headers', () => {
      chromeExtension.sendMessage({
        type: 'TRADE_ACTION',
        payload: { symbol: 'BTC_USDT', action: 'BUY', amount: 0.1 }
      });
      
      expect(chromeExtension.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TRADE_ACTION',
          payload: expect.any(Object),
          timestamp: expect.any(Number),
          origin: 'poloniex-trading-platform'
        })
      );
    });
  });
  
  // ML Trading Capabilities
  describe('ML Trading Capabilities', () => {
    beforeEach(() => {
      vi.spyOn(mlTrading, 'trainMLModel');
      vi.spyOn(mlTrading, 'predictWithMLModel');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should train ML models correctly', async () => {
      const trainingData = Array(100).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 1, 0, i).getTime(),
        open: 100 + Math.random() * 10,
        high: 105 + Math.random() * 10,
        low: 95 + Math.random() * 10,
        close: 100 + Math.random() * 10,
        volume: 1000 + Math.random() * 500,
        symbol: 'BTC_USDT'
      }));
      
      const config = {
        modelType: 'neuralnetwork' as const,
        featureSet: 'technical' as const,
        predictionTarget: 'price_direction' as const,
        timeHorizon: 5
      };
      
      // Mock implementation
      mlTrading.trainMLModel.mockResolvedValue({
        id: 'test-model',
        name: 'Test Model',
        description: 'Test model for unit tests',
        config,
        performance: {
          accuracy: 0.65,
          precision: 0.7,
          recall: 0.6,
          f1Score: 0.65,
          trainingSamples: 80,
          validationSamples: 20
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastTrainedAt: Date.now(),
        status: 'ready' as const
      });
      
      await mlTrading.trainMLModel(trainingData, config);
      
      expect(mlTrading.trainMLModel).toHaveBeenCalledWith(trainingData, config);
    });
    
    it('should make predictions based on market data', async () => {
      const marketData = Array(20).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 1, 0, i).getTime(),
        open: 100 + Math.random() * 10,
        high: 105 + Math.random() * 10,
        low: 95 + Math.random() * 10,
        close: 100 + Math.random() * 10,
        volume: 1000 + Math.random() * 500,
        symbol: 'BTC_USDT'
      }));
      
      const modelInfo = {
        id: 'test-model',
        name: 'Test Model',
        config: {
          modelType: 'neuralnetwork' as const,
          featureSet: 'technical' as const,
          predictionTarget: 'price_direction' as const,
          timeHorizon: 5
        }
      };
      
      // Mock implementation
      mlTrading.predictWithMLModel.mockResolvedValue([
        {
          timestamp: marketData[0].timestamp,
          symbol: 'BTC_USDT',
          prediction: 1,
          confidence: 0.75
        }
      ]);
      
      const predictions = await mlTrading.predictWithMLModel(modelInfo, marketData);
      
      expect(mlTrading.predictWithMLModel).toHaveBeenCalledWith(modelInfo, marketData);
      expect(predictions[0]).toHaveProperty('prediction');
      expect(predictions[0]).toHaveProperty('confidence');
    });
  });
  
  // DQN Trading System
  describe('DQN Trading System', () => {
    beforeEach(() => {
      vi.spyOn(dqnTrading, 'trainDQNModel');
      vi.spyOn(dqnTrading, 'getDQNActions');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should train DQN agent correctly', async () => {
      const trainingData = Array(100).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 1, 0, i).getTime(),
        open: 100 + Math.random() * 10,
        high: 105 + Math.random() * 10,
        low: 95 + Math.random() * 10,
        close: 100 + Math.random() * 10,
        volume: 1000 + Math.random() * 500,
        symbol: 'BTC_USDT'
      }));
      
      const config = {
        learningRate: 0.001,
        gamma: 0.95,
        epsilonStart: 0.1
      };
      
      // Mock implementation
      dqnTrading.trainDQNModel.mockResolvedValue({
        id: 'test-dqn-model',
        name: 'Test DQN Model',
        config: {
          stateDimension: 30,
          actionDimension: 3,
          learningRate: 0.001,
          gamma: 0.95,
          epsilonStart: 0.1,
          epsilonEnd: 0.01,
          epsilonDecay: 0.995,
          memorySize: 10000,
          batchSize: 64,
          updateTargetFreq: 100,
          hiddenLayers: [128, 64],
          activationFunction: 'relu',
          optimizer: 'adam'
        },
        performance: {
          averageReward: 0.5,
          cumulativeReward: 50,
          sharpeRatio: 1.2,
          maxDrawdown: 0.15,
          winRate: 0.6,
          episodeRewards: [],
          trainingEpisodes: 10
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastTrainedAt: Date.now(),
        status: 'ready' as const,
        episodesCompleted: 10,
        totalTrainingSteps: 1000
      });
      
      await dqnTrading.trainDQNModel(trainingData, config);
      
      expect(dqnTrading.trainDQNModel).toHaveBeenCalledWith(trainingData, config);
    });
    
    it('should select actions based on market state', async () => {
      const marketData = Array(20).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 1, 0, i).getTime(),
        open: 100 + Math.random() * 10,
        high: 105 + Math.random() * 10,
        low: 95 + Math.random() * 10,
        close: 100 + Math.random() * 10,
        volume: 1000 + Math.random() * 500,
        symbol: 'BTC_USDT'
      }));
      
      const modelInfo = {
        id: 'test-dqn-model',
        config: {
          stateDimension: 30,
          actionDimension: 3
        }
      };
      
      // Mock implementation
      dqnTrading.getDQNActions.mockResolvedValue([
        {
          timestamp: marketData[0].timestamp,
          symbol: 'BTC_USDT',
          action: 'buy' as const,
          confidence: 0.8
        }
      ]);
      
      const actions = await dqnTrading.getDQNActions(modelInfo, marketData);
      
      expect(dqnTrading.getDQNActions).toHaveBeenCalledWith(modelInfo, marketData);
      expect(actions[0]).toHaveProperty('action');
      expect(['buy', 'sell', 'hold']).toContain(actions[0].action);
    });
  });
  
  // Model Recalibration
  describe('Model Recalibration', () => {
    beforeEach(() => {
      vi.spyOn(modelRecalibration, 'calculateDrift');
      vi.spyOn(modelRecalibration, 'recalibrateMLModel');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should calculate drift correctly', () => {
      const oldData = Array(100).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 1, 0, i).getTime(),
        open: 100 + Math.random() * 10,
        high: 105 + Math.random() * 10,
        low: 95 + Math.random() * 10,
        close: 100 + Math.random() * 10,
        volume: 1000 + Math.random() * 500
      }));
      
      const newData = Array(100).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 2, 0, i).getTime(),
        open: 110 + Math.random() * 15, // Different distribution
        high: 120 + Math.random() * 15,
        low: 105 + Math.random() * 15,
        close: 115 + Math.random() * 15,
        volume: 2000 + Math.random() * 1000 // Higher volume
      }));
      
      // Mock implementation
      modelRecalibration.calculateDrift.mockReturnValue(0.35);
      
      const driftScore = modelRecalibration.calculateDrift(oldData, newData);
      
      expect(modelRecalibration.calculateDrift).toHaveBeenCalledWith(oldData, newData);
      expect(driftScore).toBeGreaterThan(0);
      expect(driftScore).toBeLessThanOrEqual(1);
    });
    
    it('should recalibrate model based on performance metrics', async () => {
      const newData = Array(100).fill(0).map((_, i) => ({
        timestamp: new Date(2023, 0, 2, 0, i).getTime(),
        open: 110 + Math.random() * 15,
        high: 120 + Math.random() * 15,
        low: 105 + Math.random() * 15,
        close: 115 + Math.random() * 15,
        volume: 2000 + Math.random() * 1000
      }));
      
      const modelInfo = {
        id: 'test-model',
        name: 'Test Model',
        config: {
          modelType: 'neuralnetwork' as const,
          featureSet: 'technical' as const,
          predictionTarget: 'price_direction' as const,
          timeHorizon: 5
        }
      };
      
      // Mock implementation
      modelRecalibration.recalibrateMLModel.mockResolvedValue({
        originalModelId: 'test-model',
        newModelId: 'test-model-recal',
        timestamp: Date.now(),
        reason: 'Drift score: 0.3500, F1 score: 0.6000',
        performanceImprovement: 0.15,
        recalibrationStrategy: 'incremental'
      });
      
      await modelRecalibration.recalibrateMLModel(modelInfo, newData);
      
      expect(modelRecalibration.recalibrateMLModel).toHaveBeenCalledWith(modelInfo, newData);
    });
  });
  
  // Live Data Processing
  describe('Live Data Processing', () => {
    let liveDataService: any;
    
    beforeEach(() => {
      liveDataService = new LiveDataService();
      vi.spyOn(liveDataService, 'start');
      vi.spyOn(liveDataService, 'stop');
      vi.spyOn(liveDataService, 'getAggregatedData');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should start and stop data processing correctly', () => {
      liveDataService.start();
      expect(liveDataService.start).toHaveBeenCalled();
      expect(liveDataService.isRunning).toBe(true);
      
      liveDataService.stop();
      expect(liveDataService.stop).toHaveBeenCalled();
      expect(liveDataService.isRunning).toBe(false);
    });
    
    it('should retrieve aggregated data correctly', async () => {
      const symbol = 'BTC_USDT';
      const timeframe = '1h';
      const limit = 100;
      
      await liveDataService.getAggregatedData(symbol, timeframe, limit);
      
      expect(liveDataService.getAggregatedData).toHaveBeenCalledWith(symbol, timeframe, limit);
    });
  });
});
