import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '@/App';
import { AppProviders } from '@/context/AppProviders';
import { webSocketService } from '@/services/websocketService';
import { LiveDataService } from '@/services/advancedLiveData';
import { default as mlTrading } from '@/ml/mlTrading';
import { default as dqnTrading } from '@/ml/dqnTrading';
import { default as modelRecalibration } from '@/ml/modelRecalibration';

// Mock dependencies
vi.mock('@/services/websocketService');
vi.mock('@/services/advancedLiveData');
vi.mock('@/ml/mlTrading');
vi.mock('@/ml/dqnTrading');
vi.mock('@/ml/modelRecalibration');

describe('Integration Tests', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock ML trading methods
    vi.mocked(mlTrading.trainMLModel).mockResolvedValue({
      id: 'test-model',
      name: 'Test Model',
      description: 'Test ML model',
      config: {
        modelType: 'neuralnetwork',
        featureSet: 'technical',
        predictionTarget: 'price_direction',
        timeHorizon: 5
      },
      performance: {
        accuracy: 0.75,
        precision: 0.8,
        recall: 0.7,
        f1Score: 0.75,
        trainingSamples: 1000,
        validationSamples: 200
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTrainedAt: Date.now(),
      status: 'ready'
    });
    
    vi.mocked(dqnTrading.trainDQNModel).mockResolvedValue({
      id: 'test-agent',
      name: 'Test DQN Agent',
      description: 'Test DQN agent',
      config: {
        stateSize: 4,
        actionSize: 3,
        learningRate: 0.001,
        memorySize: 10000,
        batchSize: 32
      },
      performance: {
        averageReward: 100,
        maxReward: 200,
        episodeLength: 1000
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTrainedAt: Date.now(),
      status: 'ready'
    });
    
    // Mock LiveDataService
    if (LiveDataService.prototype.fetchOrderBook) {
      vi.mocked(LiveDataService.prototype.fetchOrderBook).mockResolvedValue({
        asks: [],
        bids: []
      });
    }
    
    // Mock additional ML methods
    vi.mocked(mlTrading.predictWithMLModel).mockResolvedValue([
      { prediction: 1, confidence: 0.8, timestamp: Date.now(), symbol: 'BTC_USDT' }
    ]);
    
    vi.mocked(dqnTrading.getDQNActions).mockResolvedValue([
      { action: 'buy', confidence: 0.7 }
    ]);
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  it('should render main application components', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for app to load
    await waitFor(() => {
      expect(screen.getByText(/Poloniex Trading Platform/i)).toBeInTheDocument();
    });
    
    // Check for main navigation elements
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Trading/i)).toBeInTheDocument();
    expect(screen.getByText(/Strategies/i)).toBeInTheDocument();
    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
  });
  
  it('should navigate between main sections', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for app to load
    await waitFor(() => {
      expect(screen.getByText(/Poloniex Trading Platform/i)).toBeInTheDocument();
    });
    
    // Navigate to Trading
    fireEvent.click(screen.getByText(/Trading/i));
    await waitFor(() => {
      expect(screen.getByText(/Live Trading/i)).toBeInTheDocument();
    });
    
    // Navigate to Strategies
    fireEvent.click(screen.getByText(/Strategies/i));
    await waitFor(() => {
      expect(screen.getByText(/Strategy Builder/i)).toBeInTheDocument();
    });
    
    // Navigate to Settings
    fireEvent.click(screen.getByText(/Settings/i));
    await waitFor(() => {
      expect(screen.getByText(/Trading Settings/i)).toBeInTheDocument();
    });
  });
  
  it('should connect to WebSocket service on startup', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for app to load and verify WebSocket connection
    await waitFor(() => {
      expect(WebSocketService.prototype.connect).toHaveBeenCalled();
    });
  });
  
  it('should start live data service on startup', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for app to load and verify LiveDataService start
    await waitFor(() => {
      expect(LiveDataService.prototype.start).toHaveBeenCalled();
    });
  });
  
  it('should handle ML trading predictions', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for ML trading panel to load
    await waitFor(() => {
      expect(screen.getByText(/ML Trading/i)).toBeInTheDocument();
    });
    
    // Trigger prediction (assuming there's a "Get Prediction" button)
    const predictButton = screen.getByText(/Get Prediction/i);
    fireEvent.click(predictButton);
    
    // Verify ML prediction was called
    await waitFor(() => {
      expect(mlTrading.predictWithMLModel).toHaveBeenCalled();
    });
  });
  
  it('should handle DQN trading actions', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for DQN trading panel to load
    await waitFor(() => {
      expect(screen.getByText(/DQN Trading/i)).toBeInTheDocument();
    });
    
    // Trigger action (assuming there's a "Get Action" button)
    const actionButton = screen.getByText(/Get Action/i);
    fireEvent.click(actionButton);
    
    // Verify DQN action was called
    await waitFor(() => {
      expect(dqnTrading.getDQNActions).toHaveBeenCalled();
    });
  });
  
  it('should handle model recalibration', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>
    );
    
    // Wait for recalibration panel to load
    await waitFor(() => {
      expect(screen.getByText(/Model Recalibration/i)).toBeInTheDocument();
    });
    
    // Trigger recalibration (assuming there's a "Recalibrate" button)
    const recalibrateButton = screen.getByText(/Recalibrate/i);
    fireEvent.click(recalibrateButton);
    
    // Verify recalibration was initiated
    await waitFor(() => {
      // Check for success message or other indicators
      expect(screen.getByText(/Recalibration started/i)).toBeInTheDocument();
    });
  });
});