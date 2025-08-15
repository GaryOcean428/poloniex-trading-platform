import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '@/context/AppProviders';
import LiveDataDashboard from '@/components/dashboard/LiveDataDashboard';
import { MLTradingPanel } from '@/components/trading/MLTradingPanel';
import { DQNTradingPanel } from '@/components/trading/DQNTradingPanel';
import { ModelRecalibrationPanel } from '@/components/ml/ModelRecalibrationPanel';
import { LiveDataService } from '@/services/advancedLiveData';
import { default as mlTrading } from '@/ml/mlTrading';
import * as dqnTrading from '@/ml/dqnTrading';
import { default as modelRecalibration } from '@/ml/modelRecalibration';

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
      (LiveDataService.prototype as any).getAggregatedData = vi.fn().mockResolvedValue([
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
      expect((sourceSelect as HTMLSelectElement).value).toBe('websocket');
      expect((anomalyToggle as HTMLInputElement).checked).toBe(false);
    });
  });
  
  // MLTradingPanel Tests
  describe('MLTradingPanel', () => {
    beforeEach(() => {
      // Mock ML trading methods
      mlTrading.trainMLModel = vi.fn().mockResolvedValue({
        id: 'test-model',
        name: 'Test Model',
        description: 'Test model for unit tests',
        config: {
          modelType: 'neuralnetwork',
          featureSet: 'technical',
          predictionTarget: 'price_direction',
          timeHorizon: 5
        },
        performance: {
          accuracy: 0.78,
          precision: 0.75,
          recall: 0.72,
          f1Score: 0.73,
          trainingSamples: 800,
          validationSamples: 200
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastTrainedAt: Date.now(),
        status: 'ready'
      });
      
      mlTrading.predictWithMLModel = vi.fn().mockResolvedValue([
        {
          timestamp: Date.now(),
          symbol: 'BTC_USDT',
          prediction: 1,
          confidence: 0.85
        }
      ]);
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
      expect(mlTrading.trainMLModel).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          hyperParameters: expect.objectContaining({
            learningRate: 0.01
          })
        }),
        expect.any(String)
      );
      
      // Results should be displayed after training
      await waitFor(() => {
        expect(screen.getByText(/Training Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Accuracy: 78%/i)).toBeInTheDocument();
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
      expect(mlTrading.predictWithMLModel).toHaveBeenCalled();
      
      // Prediction results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/BUY/i)).toBeInTheDocument();
        expect(screen.getByText(/Confidence: 85%/i)).toBeInTheDocument();
      });
      
      // Execute trade button should be available
      expect(screen.getByText(/Execute Trade/i)).toBeInTheDocument();
    });
  });
  
  // DQNTradingPanel Tests
  describe('DQNTradingPanel', () => {
    beforeEach(() => {
      // Mock DQN trading methods
      vi.mocked(dqnTrading.trainDQNModel).mockResolvedValue({
        id: 'test-dqn-model',
        name: 'Test DQN Model',
        description: 'Test DQN model for unit tests',
        config: {
          stateDimension: 30,
          actionDimension: 3,
          learningRate: 0.001,
          gamma: 0.99,
          epsilonStart: 1.0,
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
          averageReward: 85.2,
          cumulativeReward: 8520,
          sharpeRatio: 1.2,
          maxDrawdown: 0.15,
          winRate: 0.65,
          episodeRewards: [],
          trainingEpisodes: 100
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastTrainedAt: Date.now(),
        status: 'ready',
        episodesCompleted: 100,
        totalTrainingSteps: 10000
      });
      
      vi.mocked(dqnTrading.createDQNAction).mockReturnValue({
        timestamp: Date.now(),
        symbol: 'BTC_USDT',
        action: 'buy',
        confidence: 0.92
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
      expect(dqnTrading.trainDQNModel).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          learningRate: 0.001,
          epsilonStart: 0.1
        }),
        expect.any(String),
        200
      );
      
      // Results should be displayed after training
      await waitFor(() => {
        expect(screen.getByText(/Training Complete/i)).toBeInTheDocument();
      });
    });
    
    it('should handle agent actions', async () => {
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
      expect(dqnTrading.createDQNAction).toHaveBeenCalled();
      
      // Action results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/BUY/i)).toBeInTheDocument();
        expect(screen.getByText(/Confidence: 92%/i)).toBeInTheDocument();
      });
      
      // Execute trade button should be available
      expect(screen.getByText(/Execute Trade/i)).toBeInTheDocument();
    });
  });
  
  // ModelRecalibrationPanel Tests
  describe('ModelRecalibrationPanel', () => {
    beforeEach(() => {
      // Mock model recalibration methods
      modelRecalibration.calculateDrift = vi.fn().mockReturnValue(0.35);
      
      modelRecalibration.monitorMLModelPerformance = vi.fn().mockResolvedValue({
        timestamp: Date.now(),
        modelId: 'test-model',
        modelType: 'ml',
        accuracy: 0.72,
        precision: 0.68,
        recall: 0.65,
        f1Score: 0.66,
        winRate: 0.60,
        driftScore: 0.35
      });
      
      modelRecalibration.recalibrateMLModel = vi.fn().mockResolvedValue({
        originalModelId: 'test-model',
        newModelId: 'test-model-recal',
        timestamp: Date.now(),
        reason: 'Drift score: 0.3500, F1 score: 0.6600',
        performanceImprovement: 0.15,
        recalibrationStrategy: 'incremental'
      });
      
      modelRecalibration.scheduleModelRecalibration = vi.fn().mockResolvedValue({
        originalModelId: 'test-model',
        newModelId: 'test-model-recal',
        timestamp: Date.now(),
        reason: 'Drift score: 0.3500, F1 score: 0.6600',
        performanceImprovement: 0.15,
        recalibrationStrategy: 'incremental'
      });
    });
    
    it('should render model recalibration panel', async () => {
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
      
      // Model selection should be available
      expect(screen.getByText(/Select Model/i)).toBeInTheDocument();
      
      // Recalibration controls should be available
      expect(screen.getByText(/Recalibration Settings/i)).toBeInTheDocument();
      expect(screen.getByText(/Recalibrate/i)).toBeInTheDocument();
      
      // Monitoring section should be available
      expect(screen.getByText(/Performance Monitoring/i)).toBeInTheDocument();
      expect(screen.getByText(/Check Performance/i)).toBeInTheDocument();
    });
    
    it('should monitor model performance', async () => {
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
      
      // Select model
      const modelSelect = screen.getByLabelText(/Model/i);
      fireEvent.change(modelSelect, { target: { value: 'test-model' } });
      
      // Check performance
      const checkButton = screen.getByText(/Check Performance/i);
      fireEvent.click(checkButton);
      
      // Performance check should be called
      expect(modelRecalibration.monitorMLModelPerformance).toHaveBeenCalled();
      
      // Performance results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/Accuracy: 72%/i)).toBeInTheDocument();
        expect(screen.getByText(/F1 Score: 66%/i)).toBeInTheDocument();
        expect(screen.getByText(/Drift Score: 35%/i)).toBeInTheDocument();
      });
      
      // Drift warning should be displayed
      expect(screen.getByText(/Significant drift detected/i)).toBeInTheDocument();
    });
    
    it('should recalibrate model', async () => {
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
      
      // Select model
      const modelSelect = screen.getByLabelText(/Model/i);
      fireEvent.change(modelSelect, { target: { value: 'test-model' } });
      
      // Select recalibration strategy
      const strategySelect = screen.getByLabelText(/Strategy/i);
      fireEvent.change(strategySelect, { target: { value: 'incremental' } });
      
      // Recalibrate
      const recalibrateButton = screen.getByText(/Recalibrate/i);
      fireEvent.click(recalibrateButton);
      
      // Recalibration should be called
      expect(modelRecalibration.recalibrateMLModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'incremental'
      );
      
      // Recalibration results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/Recalibration Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Performance Improvement: \+15%/i)).toBeInTheDocument();
        expect(screen.getByText(/New Model ID: test-model-recal/i)).toBeInTheDocument();
      });
    });
    
    it('should schedule automatic recalibration', async () => {
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
      
      // Select model
      const modelSelect = screen.getByLabelText(/Model/i);
      fireEvent.change(modelSelect, { target: { value: 'test-model' } });
      
      // Configure auto-recalibration
      const driftThresholdInput = screen.getByLabelText(/Drift Threshold/i);
      fireEvent.change(driftThresholdInput, { target: { value: '0.2' } });
      
      const autoRecalibrateToggle = screen.getByLabelText(/Auto-Recalibrate/i);
      fireEvent.click(autoRecalibrateToggle);
      
      // Save settings
      const saveButton = screen.getByText(/Save Settings/i);
      fireEvent.click(saveButton);
      
      // Settings should be saved
      await waitFor(() => {
        expect(screen.getByText(/Settings Saved/i)).toBeInTheDocument();
      });
      
      // Schedule recalibration
      const scheduleButton = screen.getByText(/Schedule Recalibration/i);
      fireEvent.click(scheduleButton);
      
      // Scheduling should be called
      expect(modelRecalibration.scheduleModelRecalibration).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          driftThreshold: 0.2,
          autoRecalibrate: true
        }),
        expect.anything()
      );
      
      // Schedule results should be displayed
      await waitFor(() => {
        expect(screen.getByText(/Recalibration Scheduled/i)).toBeInTheDocument();
      });
    });
  });
});