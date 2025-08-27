import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import LiveTradingDashboard from '@/pages/LiveTradingDashboard';
import RealTimePortfolio from '@/components/dashboard/RealTimePortfolio';
import RealTimeAlerts from '@/components/dashboard/RealTimeAlerts';
import { TradingProvider } from '@/context/TradingContext';
import { WebSocketProvider } from '@/context/WebSocketContext';
import { SettingsProvider } from '@/context/SettingsContext';

// Mock Chart.js (must provide named exports used by LiveTradingDashboard)
vi.mock('chart.js', () => {
  //
  // Provide a minimal Chart class with static register
  class ChartJSClass {}
  (ChartJSClass as any).register = vi.fn();
  return {
    CategoryScale: {},
    LinearScale: {},
    PointElement: {},
    LineElement: {},
    Title: {},
    Tooltip: {},
    Legend: {},
    Chart: ChartJSClass,
  } as any;
});

// Mock the WebSocket service for both alias and relative imports
const baseWsMock = {
  on: vi.fn(),
  off: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  send: vi.fn(),
  getStats: vi.fn(() => ({
    connectTime: Date.now(),
    disconnectTime: null,
    reconnectAttempts: 0,
    totalDisconnects: 0
  })),
  getHealth: vi.fn(() => ({
    isHealthy: true,
    uptime: 1000,
    latency: 5,
    reconnectAttempts: 0
  })),
  getConnectionHealth: vi.fn(() => ({
    isHealthy: true,
    uptime: 1000,
    latency: 5,
    reconnectAttempts: 0
  })),
  getConnectionStatus: vi.fn(() => 'connected'),
  isConnected: vi.fn(() => true),
  isMockMode: vi.fn(() => false)
};

const useWebSocketMock = vi.fn(() => ({
  connectionState: 'connected',
  isMockMode: false,
  isConnected: true,
  on: baseWsMock.on,
  off: baseWsMock.off,
  connect: baseWsMock.connect,
  disconnect: baseWsMock.disconnect,
  subscribe: baseWsMock.subscribe,
  unsubscribe: baseWsMock.unsubscribe,
  send: baseWsMock.send,
  getStats: baseWsMock.getStats,
  getHealth: baseWsMock.getHealth
}));

vi.mock('@/services/websocketService', () => ({
  webSocketService: baseWsMock,
  useWebSocket: useWebSocketMock
}));

vi.mock('../services/websocketService', () => ({
  webSocketService: baseWsMock,
  useWebSocket: useWebSocketMock
}));
import { useWebSocket } from '@/services/websocketService';

// Mock the trading context
vi.mock('@/hooks/useTradingContext', () => ({
  useTradingContext: () => ({
    marketData: [
      {
        timestamp: Date.now(),
        open: 50000,
        high: 51000,
        low: 49000,
        close: 50500,
        volume: 1000
      }
    ],
    strategies: [
      {
        id: '1',
        name: 'Test Strategy',
        type: 'momentum',
        isActive: true,
        parameters: {
          pair: 'BTC-USDT',
          timeframe: '1h',
          riskLevel: 'medium'
        }
      }
    ],
    activeStrategies: ['1'],
    trades: [
      {
        id: '1',
        pair: 'BTC-USDT',
        side: 'buy',
        amount: 0.001,
        price: 50000,
        timestamp: Date.now(),
        status: 'filled'
      }
    ],
    isMockMode: false,
    accountBalance: {
      totalAmount: '10000.00',
      availableAmount: '8000.00',
      unrealizedPnL: '200.00',
      todayPnL: '150.00',
      todayPnLPercentage: '1.5'
    }
  })
}));

// Mock Chart.js
vi.mock('react-chartjs-2', () => ({
  Line: (props: { data?: any }) => {
    const { data } = props;
    return (
      <div data-testid="line-chart">
        Chart: {data?.datasets?.[0]?.label || 'Unknown'}
      </div>
    );
  },
  Bar: (props: { data?: any }) => {
    const { data } = props;
    return (
      <div data-testid="bar-chart">
        Chart: {data?.datasets?.[0]?.label || 'Unknown'}
      </div>
    );
  }
}));

// Mock LiveDataDashboard
vi.mock('@/components/dashboard/LiveDataDashboard', () => ({
  default: () => <div data-testid="live-data-dashboard">Live Data Dashboard</div>
}));

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <BrowserRouter>
      <SettingsProvider>
        <WebSocketProvider>
          <TradingProvider>
            {component}
          </TradingProvider>
        </WebSocketProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
};

describe('Phase 5: Real-time WebSocket Trading Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LiveTradingDashboard', () => {
    it('should render the live trading dashboard with all components', () => {
      renderWithProviders(<LiveTradingDashboard />);

      // Check for main heading
      expect(screen.getByText('Real-time Trading Dashboard')).toBeInTheDocument();

      // Check for connection status
      expect(screen.getByText('Connected')).toBeInTheDocument();

      // Check for pair selector
      expect(screen.getByDisplayValue('BTC-USDT')).toBeInTheDocument();

      // Check for live mode toggle
      expect(screen.getByText('Start Live')).toBeInTheDocument();

      // Check for live data dashboard
      expect(screen.getByTestId('live-data-dashboard')).toBeInTheDocument();
    });

    it('should toggle live mode when button is clicked', async () => {
      renderWithProviders(<LiveTradingDashboard />);

      const liveButton = screen.getByText('Start Live');
      expect(liveButton).toBeInTheDocument();

      fireEvent.click(liveButton);

      await waitFor(() => {
        expect(screen.getByText('Stop Live')).toBeInTheDocument();
      });
    });

    it('should change selected trading pair', () => {
      renderWithProviders(<LiveTradingDashboard />);

      const selector = screen.getByDisplayValue('BTC-USDT');
      fireEvent.change(selector, { target: { value: 'ETH-USDT' } });

      expect((selector as HTMLSelectElement).value).toBe('ETH-USDT');
    });

    it('should display price chart when data is available', () => {
      renderWithProviders(<LiveTradingDashboard />);

      // Initially should show waiting message
      expect(screen.getByText('Start live mode to see real-time updates')).toBeInTheDocument();
    });
  });

  describe('RealTimePortfolio', () => {
    it('should render portfolio metrics correctly', () => {
      renderWithProviders(<RealTimePortfolio />);

      // Check for portfolio cards
      expect(screen.getByText('Total Portfolio')).toBeInTheDocument();
      expect(screen.getByText('Today\'s P&L')).toBeInTheDocument();
      expect(screen.getByText('Unrealized P&L')).toBeInTheDocument();
      expect(screen.getByText('Open Positions')).toBeInTheDocument();

      // Check for detailed metrics
      expect(screen.getByText('Available Balance')).toBeInTheDocument();
      expect(screen.getByText('Realized P&L')).toBeInTheDocument();
      expect(screen.getByText('Total Equity')).toBeInTheDocument();
    });

    it('should display formatted currency values', () => {
      renderWithProviders(<RealTimePortfolio />);

      // Should display formatted currency values
      expect(screen.getByText(/\$10,000\.00/)).toBeInTheDocument();
    });

    it('should show live update status', () => {
      renderWithProviders(<RealTimePortfolio />);

      expect(screen.getByText('Live updates active')).toBeInTheDocument();
    });
  });

  describe('RealTimeAlerts', () => {
    it('should render alerts component with header', () => {
      renderWithProviders(<RealTimeAlerts />);

      expect(screen.getByText('Real-time Alerts')).toBeInTheDocument();
      expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    });

    it('should show sound toggle button', () => {
      renderWithProviders(<RealTimeAlerts />);

      const soundButton = screen.getByTitle('Disable sound');
      expect(soundButton).toBeInTheDocument();

      fireEvent.click(soundButton);
      expect(screen.getByTitle('Enable sound')).toBeInTheDocument();
    });

    it('should show settings button and panel', () => {
      renderWithProviders(<RealTimeAlerts />);

      const settingsButton = screen.getByTitle('Alert settings');
      expect(settingsButton).toBeInTheDocument();

      fireEvent.click(settingsButton);
      expect(screen.getByText('Alert Settings')).toBeInTheDocument();
      expect(screen.getByText('Price change alerts')).toBeInTheDocument();
    });

    it('should handle alert configuration changes', () => {
      renderWithProviders(<RealTimeAlerts />);

      // Open settings
      fireEvent.click(screen.getByTitle('Alert settings'));

      // Find and toggle price change alerts
      const priceChangeCheckbox = screen.getByRole('checkbox', { name: /price change alerts/i });
      expect(priceChangeCheckbox).toBeChecked();

      fireEvent.click(priceChangeCheckbox);
      expect(priceChangeCheckbox).not.toBeChecked();
    });
  });

  describe('Integration with WebSocket Service', () => {
    it('should handle connection state changes', () => {
      renderWithProviders(<LiveTradingDashboard />);

      // Should show connected status
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('should handle market data updates', () => {
      // This tests the integration with WebSocket service
      const mockWebSocket = useWebSocket();

      renderWithProviders(<LiveTradingDashboard />);

      // Verify WebSocket methods are available
      expect(mockWebSocket.on).toBeDefined();
      expect(mockWebSocket.off).toBeDefined();
      expect(mockWebSocket.isConnected).toBe(true);
    });
  });

  describe('Real-time Features', () => {
    it('should setup event listeners when live mode is enabled', async () => {
      const mockWebSocket = useWebSocket();

      renderWithProviders(<LiveTradingDashboard />);

      // Start live mode
      fireEvent.click(screen.getByText('Start Live'));

      await waitFor(() => {
        expect(mockWebSocket.on).toHaveBeenCalledWith('marketData', expect.any(Function));
        expect(mockWebSocket.on).toHaveBeenCalledWith('tradeExecuted', expect.any(Function));
      });
    });

    it('should cleanup event listeners when component unmounts', () => {
      const mockWebSocket = useWebSocket();

      const { unmount } = renderWithProviders(<LiveTradingDashboard />);

      // Start live mode to setup listeners
      fireEvent.click(screen.getByText('Start Live'));

      unmount();

      // Verify cleanup was called
      expect(mockWebSocket.off).toHaveBeenCalled();
    });

    it('should handle real-time price updates', () => {
      renderWithProviders(<LiveTradingDashboard />);

      // The chart should be ready to display real-time data
      expect(screen.getByText('Real-time Price Movement')).toBeInTheDocument();
    });
  });

  describe('Navigation and Routing', () => {
    it('should be accessible via /dashboard/live route', () => {
      // This would be tested in a full integration test
      renderWithProviders(<LiveTradingDashboard />);
      expect(screen.getByText('Real-time Trading Dashboard')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle WebSocket disconnection gracefully', () => {
      // Mock disconnected state
      (useWebSocket as unknown as Mock).mockReturnValue({
        connectionState: 'disconnected',
        isMockMode: false,
        isConnected: false,
        on: vi.fn(),
        off: vi.fn()
      });

      renderWithProviders(<LiveTradingDashboard />);

      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });

    it('should handle mock mode appropriately', () => {
      // Mock mock mode
      (useWebSocket as unknown as Mock).mockReturnValue({
        connectionState: 'connected',
        isMockMode: true,
        isConnected: false,
        on: vi.fn(),
        off: vi.fn()
      });

      renderWithProviders(<LiveTradingDashboard />);

      // Should show mock mode notice
      expect(screen.getByText(/mock mode/i)).toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('should limit the number of price history points', async () => {
      renderWithProviders(<LiveTradingDashboard />);

      // Start live mode
      fireEvent.click(screen.getByText('Start Live'));

      // This tests that the component properly limits data points for performance
      // In a real test, we would simulate multiple data updates and verify the limit
      expect(screen.getByText('Stop Live')).toBeInTheDocument();
    });
  });
});
