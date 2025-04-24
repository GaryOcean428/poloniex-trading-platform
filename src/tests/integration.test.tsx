import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { AppProviders } from '@/context/AppProviders';
import { WebSocketService } from '@/services/websocketService';
import { LiveDataService } from '@/services/advancedLiveData';
import { mlTrading } from '@/ml/mlTrading';
import { dqnTrading } from '@/ml/dqnTrading';

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
      bids: [],
      asks: []
    });
    LiveDataService.prototype.fetchTrades = vi.fn().mockResolvedValue([]);
    
    // Mock ML models
    mlTrading.predictNextMove = vi.fn().mockResolvedValue({
      action: 'HOLD',
      confidence: 0.7
    });
    
    dqnTrading.getAction = vi.fn().mockReturnValue(0); // HOLD
  });
  
  it('should render the application without crashing', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for initial loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
    
    // App should render with navigation elements
    expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
  });
  
  it('should navigate between main routes', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for initial loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
    
    // Navigate to different routes
    const dashboardLink = screen.getByText(/dashboard/i);
    const tradingLink = screen.getByText(/trading/i);
    const strategiesLink = screen.getByText(/strategies/i);
    
    // Click on Trading
    fireEvent.click(tradingLink);
    await waitFor(() => {
      expect(screen.getByText(/trading panel/i)).toBeInTheDocument();
    });
    
    // Click on Strategies
    fireEvent.click(strategiesLink);
    await waitFor(() => {
      expect(screen.getByText(/strategy builder/i)).toBeInTheDocument();
    });
    
    // Go back to Dashboard
    fireEvent.click(dashboardLink);
    await waitFor(() => {
      expect(screen.getByText(/market overview/i)).toBeInTheDocument();
    });
  });
  
  it('should toggle between light and dark mode', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for initial loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
    
    // Find theme toggle button
    const themeToggle = screen.getByLabelText(/toggle theme/i);
    
    // Get initial theme
    const initialTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    
    // Toggle theme
    fireEvent.click(themeToggle);
    
    // Check if theme changed
    const newTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    expect(newTheme).not.toBe(initialTheme);
  });
  
  it('should toggle mock mode', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for settings page to load
    await waitFor(() => {
      expect(screen.getByText(/mock mode/i)).toBeInTheDocument();
    });
    
    // Find mock mode toggle
    const mockModeToggle = screen.getByLabelText(/enable mock mode/i);
    
    // Toggle mock mode
    fireEvent.click(mockModeToggle);
    
    // Mock mode settings should be visible
    await waitFor(() => {
      expect(screen.getByText(/mock data configuration/i)).toBeInTheDocument();
    });
  });
  
  it('should handle WebSocket connection status changes', async () => {
    // Create a mock implementation that simulates connection events
    let connectionCallback;
    WebSocketService.prototype.onConnectionStatusChange = vi.fn(callback => {
      connectionCallback = callback;
    });
    
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for initial loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
    
    // Simulate connection status change
    connectionCallback('connected');
    
    // Connection status should be updated in UI
    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
    
    // Simulate disconnection
    connectionCallback('disconnected');
    
    // Connection status should be updated in UI
    await waitFor(() => {
      expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
    });
  });
  
  it('should handle API errors gracefully', async () => {
    // Mock API error
    LiveDataService.prototype.getAggregatedData = vi.fn().mockRejectedValue(
      new Error('API Error')
    );
    
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for initial loading to complete and error to appear
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
    
    // Error message should be displayed
    expect(screen.getByText(/api error/i)).toBeInTheDocument();
    
    // Retry button should be available
    const retryButton = screen.getByText(/retry/i);
    expect(retryButton).toBeInTheDocument();
    
    // Mock successful response for retry
    LiveDataService.prototype.getAggregatedData = vi.fn().mockResolvedValue([]);
    
    // Click retry
    fireEvent.click(retryButton);
    
    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText(/api error/i)).not.toBeInTheDocument();
    });
  });
});

describe('End-to-End Trading Flow', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock services for E2E testing
    WebSocketService.prototype.connect = vi.fn();
    LiveDataService.prototype.getAggregatedData = vi.fn().mockResolvedValue([
      {
        timestamp: Date.now(),
        open: 50000,
        high: 51000,
        low: 49000,
        close: 50500,
        volume: 100
      }
    ]);
    
    mlTrading.predictNextMove = vi.fn().mockResolvedValue({
      action: 'BUY',
      confidence: 0.85
    });
    
    dqnTrading.getAction = vi.fn().mockReturnValue(1); // BUY
  });
  
  it('should execute a complete trading flow', async () => {
    // Mock trade execution
    const executeTradeMock = vi.fn().mockResolvedValue({
      success: true,
      orderId: '12345',
      price: 50500,
      amount: 0.1,
      side: 'buy'
    });
    
    // Inject mock into global window
    window.executeTrade = executeTradeMock;
    
    render(
      <MemoryRouter initialEntries={['/trading']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for trading page to load
    await waitFor(() => {
      expect(screen.getByText(/trading panel/i)).toBeInTheDocument();
    });
    
    // Select trading pair
    const pairSelector = screen.getByLabelText(/select pair/i);
    fireEvent.change(pairSelector, { target: { value: 'BTC_USDT' } });
    
    // Enter amount
    const amountInput = screen.getByLabelText(/amount/i);
    fireEvent.change(amountInput, { target: { value: '0.1' } });
    
    // Click Buy button
    const buyButton = screen.getByText(/buy/i);
    fireEvent.click(buyButton);
    
    // Confirm trade
    const confirmButton = screen.getByText(/confirm/i);
    fireEvent.click(confirmButton);
    
    // Trade execution should be called
    await waitFor(() => {
      expect(executeTradeMock).toHaveBeenCalledWith({
        pair: 'BTC_USDT',
        side: 'buy',
        amount: 0.1,
        price: 50500
      });
    });
    
    // Success message should be displayed
    await waitFor(() => {
      expect(screen.getByText(/trade executed successfully/i)).toBeInTheDocument();
      expect(screen.getByText(/order id: 12345/i)).toBeInTheDocument();
    });
  });
  
  it('should handle automated trading flow', async () => {
    // Mock automated trading service
    const startAutomatedTradingMock = vi.fn();
    const stopAutomatedTradingMock = vi.fn();
    
    // Inject mocks into global window
    window.startAutomatedTrading = startAutomatedTradingMock;
    window.stopAutomatedTrading = stopAutomatedTradingMock;
    
    render(
      <MemoryRouter initialEntries={['/trading/automation']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for automation panel to load
    await waitFor(() => {
      expect(screen.getByText(/automation panel/i)).toBeInTheDocument();
    });
    
    // Select strategy
    const strategySelector = screen.getByLabelText(/select strategy/i);
    fireEvent.change(strategySelector, { target: { value: 'ml-strategy' } });
    
    // Configure parameters
    const maxAmountInput = screen.getByLabelText(/maximum amount/i);
    fireEvent.change(maxAmountInput, { target: { value: '0.5' } });
    
    // Start automated trading
    const startButton = screen.getByText(/start automation/i);
    fireEvent.click(startButton);
    
    // Automated trading should be started
    await waitFor(() => {
      expect(startAutomatedTradingMock).toHaveBeenCalledWith({
        strategy: 'ml-strategy',
        maxAmount: 0.5,
        pair: expect.any(String)
      });
    });
    
    // Status should be updated
    await waitFor(() => {
      expect(screen.getByText(/automation active/i)).toBeInTheDocument();
    });
    
    // Stop automated trading
    const stopButton = screen.getByText(/stop automation/i);
    fireEvent.click(stopButton);
    
    // Automated trading should be stopped
    await waitFor(() => {
      expect(stopAutomatedTradingMock).toHaveBeenCalled();
    });
    
    // Status should be updated
    await waitFor(() => {
      expect(screen.getByText(/automation inactive/i)).toBeInTheDocument();
    });
  });
  
  it('should handle ML model training and prediction', async () => {
    // Mock ML training
    mlTrading.trainModel = vi.fn().mockResolvedValue({
      success: true,
      accuracy: 0.78,
      epochs: 100
    });
    
    render(
      <MemoryRouter initialEntries={['/trading/ml']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for ML panel to load
    await waitFor(() => {
      expect(screen.getByText(/ml trading/i)).toBeInTheDocument();
    });
    
    // Configure training parameters
    const epochsInput = screen.getByLabelText(/epochs/i);
    fireEvent.change(epochsInput, { target: { value: '100' } });
    
    // Start training
    const trainButton = screen.getByText(/train model/i);
    fireEvent.click(trainButton);
    
    // Training should be started
    await waitFor(() => {
      expect(mlTrading.trainModel).toHaveBeenCalledWith(
        expect.objectContaining({
          epochs: 100
        })
      );
    });
    
    // Training results should be displayed
    await waitFor(() => {
      expect(screen.getByText(/training complete/i)).toBeInTheDocument();
      expect(screen.getByText(/accuracy: 78%/i)).toBeInTheDocument();
    });
    
    // Get prediction
    const predictButton = screen.getByText(/get prediction/i);
    fireEvent.click(predictButton);
    
    // Prediction should be displayed
    await waitFor(() => {
      expect(screen.getByText(/recommended action/i)).toBeInTheDocument();
      expect(screen.getByText(/buy/i)).toBeInTheDocument();
      expect(screen.getByText(/confidence: 85%/i)).toBeInTheDocument();
    });
  });
});

describe('Performance Tests', () => {
  it('should handle high-frequency data updates efficiently', async () => {
    // Create a performance observer
    const performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      
      // Check if any long tasks (>50ms)
      const longTasks = entries.filter(entry => entry.duration > 50);
      expect(longTasks.length).toBe(0);
    });
    
    performanceObserver.observe({ entryTypes: ['longtask'] });
    
    // Mock high-frequency data updates
    const mockDataUpdates = [];
    for (let i = 0; i < 100; i++) {
      mockDataUpdates.push({
        timestamp: Date.now() + i * 1000,
        price: 50000 + Math.random() * 1000,
        volume: Math.random() * 10
      });
    }
    
    // Create a custom event emitter for data updates
    const dataUpdateEmitter = new EventTarget();
    
    // Mock LiveDataService to use our emitter
    LiveDataService.prototype.onDataUpdate = vi.fn(callback => {
      dataUpdateEmitter.addEventListener('data', (event) => {
        callback(event.detail);
      });
    });
    
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for dashboard to load
    await waitFor(() => {
      expect(screen.getByText(/market overview/i)).toBeInTheDocument();
    });
    
    // Start performance measurement
    performance.mark('data-updates-start');
    
    // Emit 100 data updates in rapid succession
    mockDataUpdates.forEach(data => {
      dataUpdateEmitter.dispatchEvent(
        new CustomEvent('data', { detail: data })
      );
    });
    
    // End performance measurement
    performance.mark('data-updates-end');
    performance.measure('data-updates', 'data-updates-start', 'data-updates-end');
    
    const measure = performance.getEntriesByName('data-updates')[0];
    
    // Processing 100 updates should take less than 500ms
    expect(measure.duration).toBeLessThan(500);
    
    // Clean up
    performanceObserver.disconnect();
  });
  
  it('should maintain responsiveness during intensive operations', async () => {
    // Mock intensive operation (ML training)
    mlTrading.trainModel = vi.fn().mockImplementation(() => {
      // Simulate CPU-intensive work
      const startTime = Date.now();
      while (Date.now() - startTime < 1000) {
        // Busy wait for 1 second
        Math.random() * Math.random();
      }
      return Promise.resolve({ success: true });
    });
    
    render(
      <MemoryRouter initialEntries={['/trading/ml']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    );
    
    // Wait for ML panel to load
    await waitFor(() => {
      expect(screen.getByText(/ml trading/i)).toBeInTheDocument();
    });
    
    // Start training (intensive operation)
    const trainButton = screen.getByText(/train model/i);
    fireEvent.click(trainButton);
    
    // UI should show loading state
    await waitFor(() => {
      expect(screen.getByText(/training in progress/i)).toBeInTheDocument();
    });
    
    // Try to interact with UI during intensive operation
    const navLink = screen.getByText(/dashboard/i);
    fireEvent.click(navLink);
    
    // Navigation should still work despite intensive background operation
    await waitFor(() => {
      expect(screen.getByText(/market overview/i)).toBeInTheDocument();
    });
  });
});
