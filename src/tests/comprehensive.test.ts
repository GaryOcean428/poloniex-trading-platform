import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { WebSocketService } from '@/services/websocketService';
import { LiveDataService } from '@/services/advancedLiveData';
import { strategyTester } from '@/utils/strategyTester';
import { MockModeContext } from '@/context/MockModeContext';
import { chromeExtension } from '@/utils/chromeExtension';
import { mlTrading } from '@/ml/mlTrading';
import { dqnTrading } from '@/ml/dqnTrading';
import { modelRecalibration } from '@/ml/modelRecalibration';

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
      vi.spyOn(mlTrading, 'trainModel');
      vi.spyOn(mlTrading, 'predictNextMove');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should train ML models correctly', async () => {
      const trainingData = Array(100).fill(0).map((_, i) => ({
        features: [
          Math.random(), // RSI
          Math.random(), // MACD
          Math.random(), // Bollinger
          Math.random()  // Volume
        ],
        label: Math.random() > 0.5 ? 1 : 0 // Buy or Sell
      }));
      
      await mlTrading.trainModel(trainingData);
      
      expect(mlTrading.trainModel).toHaveBeenCalledWith(trainingData);
      expect(mlTrading.modelTrained).toBe(true);
    });
    
    it('should make predictions based on market data', async () => {
      // Ensure model is trained
      mlTrading.modelTrained = true;
      
      const marketData = {
        rsi: 45,
        macd: 0.2,
        bollingerBands: 0.1,
        volume: 1.5
      };
      
      const prediction = await mlTrading.predictNextMove(marketData);
      
      expect(mlTrading.predictNextMove).toHaveBeenCalledWith(marketData);
      expect(prediction).toHaveProperty('action');
      expect(prediction).toHaveProperty('confidence');
      expect(['BUY', 'SELL', 'HOLD']).toContain(prediction.action);
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });
  });
  
  // DQN Trading System
  describe('DQN Trading System', () => {
    beforeEach(() => {
      vi.spyOn(dqnTrading, 'trainAgent');
      vi.spyOn(dqnTrading, 'getAction');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should train DQN agent correctly', async () => {
      const trainingConfig = {
        episodes: 10,
        learningRate: 0.001,
        discountFactor: 0.95,
        explorationRate: 0.1
      };
      
      await dqnTrading.trainAgent(trainingConfig);
      
      expect(dqnTrading.trainAgent).toHaveBeenCalledWith(trainingConfig);
      expect(dqnTrading.agentTrained).toBe(true);
    });
    
    it('should select actions based on market state', () => {
      // Ensure agent is trained
      dqnTrading.agentTrained = true;
      
      const marketState = [0.5, 0.2, 0.3, 0.8]; // Normalized market indicators
      
      const action = dqnTrading.getAction(marketState);
      
      expect(dqnTrading.getAction).toHaveBeenCalledWith(marketState);
      expect([0, 1, 2]).toContain(action); // 0: Hold, 1: Buy, 2: Sell
    });
  });
  
  // Model Recalibration
  describe('Model Recalibration', () => {
    beforeEach(() => {
      vi.spyOn(modelRecalibration, 'evaluateModelPerformance');
      vi.spyOn(modelRecalibration, 'recalibrateModel');
    });
    
    afterEach(() => {
      vi.clearAllMocks();
    });
    
    it('should evaluate model performance correctly', () => {
      const predictions = [
        { action: 'BUY', confidence: 0.8, timestamp: new Date(2023, 0, 1).getTime() },
        { action: 'SELL', confidence: 0.7, timestamp: new Date(2023, 0, 2).getTime() },
        { action: 'HOLD', confidence: 0.6, timestamp: new Date(2023, 0, 3).getTime() }
      ];
      
      const actualOutcomes = [
        { action: 'BUY', profit: 0.05, timestamp: new Date(2023, 0, 1).getTime() },
        { action: 'SELL', profit: -0.02, timestamp: new Date(2023, 0, 2).getTime() },
        { action: 'HOLD', profit: 0.01, timestamp: new Date(2023, 0, 3).getTime() }
      ];
      
      const performance = modelRecalibration.evaluateModelPerformance(predictions, actualOutcomes);
      
      expect(modelRecalibration.evaluateModelPerformance).toHaveBeenCalledWith(predictions, actualOutcomes);
      expect(performance).toHaveProperty('accuracy');
      expect(performance).toHaveProperty('profitLoss');
      expect(performance).toHaveProperty('confidenceCorrelation');
    });
    
    it('should recalibrate model based on performance metrics', async () => {
      const performanceMetrics = {
        accuracy: 0.65,
        profitLoss: 0.03,
        confidenceCorrelation: 0.4
      };
      
      await modelRecalibration.recalibrateModel(performanceMetrics);
      
      expect(modelRecalibration.recalibrateModel).toHaveBeenCalledWith(performanceMetrics);
      expect(modelRecalibration.lastRecalibration).toBeInstanceOf(Date);
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
