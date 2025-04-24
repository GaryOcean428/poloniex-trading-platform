import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '@/context/AppProviders';
import { LiveDataDashboard } from '@/components/dashboard/LiveDataDashboard';
import { MLTradingPanel } from '@/components/trading/MLTradingPanel';
import { DQNTradingPanel } from '@/components/trading/DQNTradingPanel';
import { ModelRecalibrationPanel } from '@/components/ml/ModelRecalibrationPanel';
import { LiveDataService } from '@/services/advancedLiveData';
import { mlTrading } from '@/ml/mlTrading';
import { dqnTrading } from '@/ml/dqnTrading';
import { modelRecalibration } from '@/ml/modelRecalibration';

// Mock dependencies
vi.mock('@/services/advancedLiveData');
vi.mock('@/ml/mlTrading');
vi.mock('@/ml/dqnTrading');
vi.mock('@/ml/modelRecalibration');

describe('Advanced Features Tests', () => {
  // LiveDataDashboard Tests
  describe('LiveDataDashboard', () => {
    beforeEach(() => {
      // Mock LiveDataService
      LiveDataService.prototype.getAggregatedData = vi.fn().mockResolvedValue([
        {
          timestamp: Date.now(),
          open: 50000,
          high: 51000,
          low: 49000,
          close: 50500,
          volume: 100,
          isAnomaly: false,
          confidence: 0
        },
        {
          timestamp: Date.now() - 60000,
          open: 49800,
          high: 50200,
          low: 49500,
          close: 50000,
          volume: 120,
          isAnomaly: true,
          confidence: 0.85
        }
      ]);
      
      LiveDataService.prototype.fetchOrderBook = vi.fn().mockResolvedValue({
        bids: [
          { price: 50400, amount: 1.5 },
          { price: 50300, amount: 2.3 }
        ],
        asks: [
          { price: 50600, amount: 1.2 },
          { price: 50700, amount: 3.1 }
        ]
      });
      
      LiveDataService.prototype.fetchTrades = vi.fn().mockResolvedValue([
        { id: '1', price: 50450, amount: 0.1, side: 'buy', timestamp: Date.now() - 30000 },
        { id: '2', price: 50480, amount: 0.2, side: 'sell', timestamp: Date.now() - 15000 }
      ]);
      
      LiveDataService.prototype.fetchMarketSummary = vi.fn().mockResolvedValue({
        lastPrice: 50500,
        percentChange24h: 2.5,
        high24h: 51000,
        low24h: 49000,
        volume24h: 1500,
        quoteVolume24h: 75000000
      });
    });
    
    it('should render live data dashboard with market data', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <LiveDataDashboard />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(/Advanced Live Data Dashboard/i)).toBeInTheDocument();
      });
      
      // Market summary should be displayed
      expect(screen.getByText(/\$50,500/)).toBeInTheDocument();
      expect(screen.getByText(/\+2.5%/)).toBeInTheDocument();
      
      // Price chart should be rendered
      expect(screen.getByText(/Price Chart/i)).toBeInTheDocument();
      
      // Tabs should be available
      expect(screen.getByText(/Order Book/i)).toBeInTheDocument();
      expect(screen.getByText(/Recent Trades/i)).toBeInTheDocument();
      expect(screen.getByText(/Anomalies/i)).toBeInTheDocument();
      
      // Click on Order Book tab
      fireEvent.click(screen.getByText(/Order Book/i));
      
      // Order book data should be displayed
      expect(screen.getByText(/50400/)).toBeInTheDocument();
      expect(screen.getByText(/50600/)).toBeInTheDocument();
      
      // Click on Recent Trades tab
      fireEvent.click(screen.getByText(/Recent Trades/i));
      
      // Trade data should be displayed
      expect(screen.getByText(/BUY/)).toBeInTheDocument();
      expect(screen.getByText(/SELL/)).toBeInTheDocument();
      
      // Click on Anomalies tab
      fireEvent.click(screen.getByText(/Anomalies/i));
      
      // Anomaly data should be displayed
      expect(screen.getByText(/PRICE ANOMALY/)).toBeInTheDocument();
      expect(screen.getByText(/85%/)).toBeInTheDocument();
    });
    
    it('should handle live data service controls', async () => {
      // Mock service methods
      LiveDataService.prototype.start = vi.fn();
      LiveDataService.prototype.stop = vi.fn();
      
      render(
        <MemoryRouter>
          <AppProviders>
            <LiveDataDashboard />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Advanced Live Data Dashboard/i)).toBeInTheDocument();
      });
      
      // Start button should be available
      const startButton = screen.getByText(/Start Live Data/i);
      expect(startButton).toBeInTheDocument();
      
      // Click start button
      fireEvent.click(startButton);
      
      // Service should be started
      expect(LiveDataService.prototype.start).toHaveBeenCalled();
      
      // Button should change to Stop
      await waitFor(() => {
        expect(screen.getByText(/Stop Live Data/i)).toBeInTheDocument();
      });
      
      // Click stop button
      fireEvent.click(screen.getByText(/Stop Live Data/i));
      
      // Service should be stopped
      expect(LiveDataService.prototype.stop).toHaveBeenCalled();
    });
    
    it('should update configuration settings', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <LiveDataDashboard />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Advanced Live Data Dashboard/i)).toBeInTheDocument();
      });
      
      // Click on Configuration tab
      fireEvent.click(screen.getByText(/Configuration/i));
      
      // Configuration options should be displayed
      expect(screen.getByText(/Data Sources/i)).toBeInTheDocument();
      expect(screen.getByText(/Data Processing/i)).toBeInTheDocument();
      
      // Change primary source
      const sourceSelect = screen.getByLabelText(/Primary Source/i);
      fireEvent.change(sourceSelect, { target: { value: 'websocket' } });
      
      // Toggle anomaly detection
      const anomalyToggle = screen.getByLabelText(/Enable Anomaly Detection/i);
      fireEvent.click(anomalyToggle);
      
      // Configuration should be updated
      // Note: We can't easily test the internal state changes without exposing them,
      // but we can verify the UI elements respond correctly
      expect(sourceSelect.value).toBe('websocket');
      expect(anomalyToggle.checked).toBe(false);
    });
  });
  
  // MLTradingPanel Tests
  describe('MLTradingPanel', () => {
    beforeEach(() => {
      // Mock ML trading methods
      mlTrading.trainModel = vi.fn().mockResolvedValue({
        success: true,
        accuracy: 0.78,
        loss: 0.12,
        epochs: 100,
        duration: 5.2
      });
      
      mlTrading.predictNextMove = vi.fn().mockResolvedValue({
        action: 'BUY',
        confidence: 0.85,
        priceTarget: 51000,
        stopLoss: 49500
      });
      
      mlTrading.getModelInfo = vi.fn().mockReturnValue({
        trained: true,
        lastTraining: new Date().toISOString(),
        accuracy: 0.78,
        features: ['price', 'volume', 'rsi', 'macd']
      });
    });
    
    it('should render ML trading panel with model information', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <MLTradingPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Machine Learning Trading/i)).toBeInTheDocument();
      });
      
      // Model info should be displayed
      expect(screen.getByText(/Model Status/i)).toBeInTheDocument();
      expect(screen.getByText(/Trained/i)).toBeInTheDocument();
      expect(screen.getByText(/78%/i)).toBeInTheDocument();
      
      // Training controls should be available
      expect(screen.getByText(/Training Parameters/i)).toBeInTheDocument();
      expect(screen.getByText(/Train Model/i)).toBeInTheDocument();
      
      // Prediction controls should be available
      expect(screen.getByText(/Market Prediction/i)).toBeInTheDocument();
      expect(screen.getByText(/Get Prediction/i)).toBeInTheDocument();
    });
    
    it('should handle model training process', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <MLTradingPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Machine Learning Trading/i)).toBeInTheDocument();
      });
      
      // Set training parameters
      const epochsInput = screen.getByLabelText(/Epochs/i);
      fireEvent.change(epochsInput, { target: { value: '200' } });
      
      const learningRateInput = screen.getByLabelText(/Learning Rate/i);
      fireEvent.change(learningRateInput, { target: { value: '0.01' } });
      
      // Start training
      const trainButton = screen.getByText(/Train Model/i);
      fireEvent.click(trainButton);
      
      // Loading state should be shown
      await waitFor(() => {
        expect(screen.getByText(/Training in progress/i)).toBeInTheDocument();
      });
      
      // Training should be called with correct parameters
      expect(mlTrading.trainModel).toHaveBeenCalledWith(
        expect.objectContaining({
          epochs: 200,
          learningRate: 0.01
        })
      );
      
      // Results should be displayed after training
      await waitFor(() => {
        expect(screen.getByText(/Training Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Accuracy: 78%/i)).toBeInTheDocument();
        expect(screen.getByText(/Loss: 0.12/i)).toBeInTheDocument();
        expect(screen.getByText(/Duration: 5.2s/i)).toBeInTheDocument();
      });
    });
    
    it('should handle market predictions', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <MLTradingPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Machine Learning Trading/i)).toBeInTheDocument();
      });
      
      // Get prediction
      const predictButton = screen.getByText(/Get Prediction/i);
      fireEvent.click(predictButton);
      
      // Prediction should be called
      expect(mlTrading.predictNextMove).toHaveBeenCalled();
      
      // Prediction results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/BUY/i)).toBeInTheDocument();
        expect(screen.getByText(/Confidence: 85%/i)).toBeInTheDocument();
        expect(screen.getByText(/Price Target: \$51,000/i)).toBeInTheDocument();
        expect(screen.getByText(/Stop Loss: \$49,500/i)).toBeInTheDocument();
      });
      
      // Execute trade button should be available
      expect(screen.getByText(/Execute Trade/i)).toBeInTheDocument();
    });
  });
  
  // DQNTradingPanel Tests
  describe('DQNTradingPanel', () => {
    beforeEach(() => {
      // Mock DQN trading methods
      dqnTrading.trainAgent = vi.fn().mockResolvedValue({
        success: true,
        episodes: 100,
        finalReward: 125.5,
        duration: 8.3
      });
      
      dqnTrading.getAction = vi.fn().mockReturnValue(1); // BUY
      
      dqnTrading.getAgentInfo = vi.fn().mockReturnValue({
        trained: true,
        lastTraining: new Date().toISOString(),
        episodes: 100,
        averageReward: 85.2,
        environment: 'poloniex-btc-usdt'
      });
      
      dqnTrading.getActionDetails = vi.fn().mockReturnValue({
        action: 'BUY',
        confidence: 0.92,
        expectedReward: 15.3,
        reasoning: [
          { factor: 'price_trend', value: 0.8, weight: 0.6 },
          { factor: 'volume', value: 0.5, weight: 0.3 },
          { factor: 'volatility', value: 0.3, weight: 0.1 }
        ]
      });
    });
    
    it('should render DQN trading panel with agent information', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <DQNTradingPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Deep Q-Network Trading/i)).toBeInTheDocument();
      });
      
      // Agent info should be displayed
      expect(screen.getByText(/Agent Status/i)).toBeInTheDocument();
      expect(screen.getByText(/Trained/i)).toBeInTheDocument();
      expect(screen.getByText(/Average Reward: 85.2/i)).toBeInTheDocument();
      
      // Training controls should be available
      expect(screen.getByText(/Training Parameters/i)).toBeInTheDocument();
      expect(screen.getByText(/Train Agent/i)).toBeInTheDocument();
      
      // Action controls should be available
      expect(screen.getByText(/Agent Decision/i)).toBeInTheDocument();
      expect(screen.getByText(/Get Action/i)).toBeInTheDocument();
    });
    
    it('should handle agent training process', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <DQNTradingPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Deep Q-Network Trading/i)).toBeInTheDocument();
      });
      
      // Set training parameters
      const episodesInput = screen.getByLabelText(/Episodes/i);
      fireEvent.change(episodesInput, { target: { value: '200' } });
      
      const learningRateInput = screen.getByLabelText(/Learning Rate/i);
      fireEvent.change(learningRateInput, { target: { value: '0.001' } });
      
      const explorationRateInput = screen.getByLabelText(/Exploration Rate/i);
      fireEvent.change(explorationRateInput, { target: { value: '0.1' } });
      
      // Start training
      const trainButton = screen.getByText(/Train Agent/i);
      fireEvent.click(trainButton);
      
      // Loading state should be shown
      await waitFor(() => {
        expect(screen.getByText(/Training in progress/i)).toBeInTheDocument();
      });
      
      // Training should be called with correct parameters
      expect(dqnTrading.trainAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          episodes: 200,
          learningRate: 0.001,
          explorationRate: 0.1
        })
      );
      
      // Results should be displayed after training
      await waitFor(() => {
        expect(screen.getByText(/Training Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Episodes: 100/i)).toBeInTheDocument();
        expect(screen.getByText(/Final Reward: 125.5/i)).toBeInTheDocument();
        expect(screen.getByText(/Duration: 8.3s/i)).toBeInTheDocument();
      });
    });
    
    it('should handle agent actions and explanations', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <DQNTradingPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Deep Q-Network Trading/i)).toBeInTheDocument();
      });
      
      // Get action
      const actionButton = screen.getByText(/Get Action/i);
      fireEvent.click(actionButton);
      
      // Action should be called
      expect(dqnTrading.getAction).toHaveBeenCalled();
      expect(dqnTrading.getActionDetails).toHaveBeenCalled();
      
      // Action results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/BUY/i)).toBeInTheDocument();
        expect(screen.getByText(/Confidence: 92%/i)).toBeInTheDocument();
        expect(screen.getByText(/Expected Reward: 15.3/i)).toBeInTheDocument();
      });
      
      // Decision factors should be displayed
      expect(screen.getByText(/Decision Factors/i)).toBeInTheDocument();
      expect(screen.getByText(/price_trend/i)).toBeInTheDocument();
      expect(screen.getByText(/volume/i)).toBeInTheDocument();
      expect(screen.getByText(/volatility/i)).toBeInTheDocument();
      
      // Execute action button should be available
      expect(screen.getByText(/Execute Action/i)).toBeInTheDocument();
    });
  });
  
  // ModelRecalibrationPanel Tests
  describe('ModelRecalibrationPanel', () => {
    beforeEach(() => {
      // Mock model recalibration methods
      modelRecalibration.evaluateModelPerformance = vi.fn().mockResolvedValue({
        accuracy: 0.72,
        profitLoss: 0.08,
        confidenceCorrelation: 0.65,
        predictionCount: 50,
        successfulPredictions: 36
      });
      
      modelRecalibration.recalibrateModel = vi.fn().mockResolvedValue({
        success: true,
        improvements: {
          accuracy: 0.05,
          confidenceCalibration: 0.12
        },
        duration: 3.7
      });
      
      modelRecalibration.getRecalibrationHistory = vi.fn().mockReturnValue([
        {
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          accuracy: { before: 0.68, after: 0.73 },
          confidenceCalibration: { before: 0.55, after: 0.67 }
        },
        {
          date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          accuracy: { before: 0.65, after: 0.68 },
          confidenceCalibration: { before: 0.48, after: 0.55 }
        }
      ]);
    });
    
    it('should render model recalibration panel with history', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <ModelRecalibrationPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Model Recalibration/i)).toBeInTheDocument();
      });
      
      // Performance metrics should be available
      expect(screen.getByText(/Performance Metrics/i)).toBeInTheDocument();
      expect(screen.getByText(/Evaluate Performance/i)).toBeInTheDocument();
      
      // Recalibration controls should be available
      expect(screen.getByText(/Recalibration/i)).toBeInTheDocument();
      expect(screen.getByText(/Recalibrate Model/i)).toBeInTheDocument();
      
      // History should be displayed
      expect(screen.getByText(/Recalibration History/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Accuracy/i).length).toBeGreaterThan(1);
      expect(screen.getAllByText(/Confidence/i).length).toBeGreaterThan(1);
    });
    
    it('should handle model performance evaluation', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <ModelRecalibrationPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Model Recalibration/i)).toBeInTheDocument();
      });
      
      // Set evaluation period
      const periodSelect = screen.getByLabelText(/Evaluation Period/i);
      fireEvent.change(periodSelect, { target: { value: '7d' } });
      
      // Start evaluation
      const evaluateButton = screen.getByText(/Evaluate Performance/i);
      fireEvent.click(evaluateButton);
      
      // Evaluation should be called
      expect(modelRecalibration.evaluateModelPerformance).toHaveBeenCalledWith(
        expect.objectContaining({
          period: '7d'
        })
      );
      
      // Results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/Accuracy: 72%/i)).toBeInTheDocument();
        expect(screen.getByText(/Profit\/Loss: \+8%/i)).toBeInTheDocument();
        expect(screen.getByText(/Confidence Correlation: 0.65/i)).toBeInTheDocument();
        expect(screen.getByText(/36\/50 successful predictions/i)).toBeInTheDocument();
      });
    });
    
    it('should handle model recalibration process', async () => {
      render(
        <MemoryRouter>
          <AppProviders>
            <ModelRecalibrationPanel />
          </AppProviders>
        </MemoryRouter>
      );
      
      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Model Recalibration/i)).toBeInTheDocument();
      });
      
      // Set recalibration options
      const focusSelect = screen.getByLabelText(/Recalibration Focus/i);
      fireEvent.change(focusSelect, { target: { value: 'confidence' } });
      
      // Start recalibration
      const recalibrateButton = screen.getByText(/Recalibrate Model/i);
      fireEvent.click(recalibrateButton);
      
      // Loading state should be shown
      await waitFor(() => {
        expect(screen.getByText(/Recalibration in progress/i)).toBeInTheDocument();
      });
      
      // Recalibration should be called with correct parameters
      expect(modelRecalibration.recalibrateModel).toHaveBeenCalledWith(
        expect.objectContaining({
          focus: 'confidence'
        })
      );
      
      // Results should be displayed after recalibration
      await waitFor(() => {
        expect(screen.getByText(/Recalibration Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Accuracy Improvement: \+5%/i)).toBeInTheDocument();
        expect(screen.getByText(/Confidence Calibration Improvement: \+12%/i)).toBeInTheDocument();
        expect(screen.getByText(/Duration: 3.7s/i)).toBeInTheDocument();
      });
    });
  });
});
