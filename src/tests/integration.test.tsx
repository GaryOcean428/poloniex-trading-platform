import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { AppProviders } from '@/context/AppProviders';
import { WebSocketService } from '@/services/websocketService';
import { LiveDataService } from '@/services/advancedLiveData';
import { default as mlTrading } from '@/ml/mlTrading';
import { default as dqnTrading } from '@/ml/dqnTrading';

// Mock dependencies
vi.mock('@/services/websocketService');
vi.mock('@/services/advancedLiveData');
vi.mock('@/ml/mlTrading');
vi.mock('@/ml/dqnTrading');

describe('Integration Tests', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock WebSocket service
    WebSocketService.prototype.connect = vi.fn();
    WebSocketService.prototype.disconnect = vi.fn();
    WebSocketService.prototype.subscribe = vi.fn();
    
    // Mock LiveDataService
    LiveDataService.prototype.start = vi.fn();
    LiveDataService.prototype.getAggregatedData = vi.fn().mockResolvedValue([]);
    LiveDataService.prototype.fetchOrderBook = vi.fn().mockResolvedValue({
      asks: [],
      bids: []
    });
    
    // Mock ML trading
    mlTrading.trainMLModel = vi.fn().mockResolvedValue({
      id: 'test-model',
      performance: { accuracy: 0.75 }
    });
    mlTrading.predictWithMLModel = vi.fn().mockResolvedValue([
      { prediction: 1, confidence: 0.8 }
    ]);
    
    // Mock DQN trading
    dqnTrading.trainDQNModel = vi.fn().mockResolvedValue({
      id: 'test-dqn-model',
      performance: { winRate: 0.6 }
    });
    dqnTrading.getDQNActions = vi.fn().mockResolvedValue([
      { action: 'buy', confidence: 0.7 }
    ]);
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  it('should render main application components', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
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
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
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
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for app to load and verify WebSocket connection
    await waitFor(() => {
      expect(WebSocketService.prototype.connect).toHaveBeenCalled();
    });
  });
  
  it('should start live data service on startup', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for app to load and verify LiveDataService start
    await waitFor(() => {
      expect(LiveDataService.prototype.start).toHaveBeenCalled();
    });
  });
  
  it('should handle ML trading predictions', async () => {
    render(
      <MemoryRouter initialEntries={['/trading/ml']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
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
      <MemoryRouter initialEntries={['/trading/dqn']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
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
      <MemoryRouter initialEntries={['/ml/recalibration']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
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