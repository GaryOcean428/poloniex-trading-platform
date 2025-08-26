import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveDataDashboard from '@/components/dashboard/LiveDataDashboard';
import { liveDataService } from '@/services/advancedLiveData';

// Mock dependencies
// Mock Tabs to a very small implementation to avoid internal cloning logic differences
vi.mock('@/components/ui/Tabs', () => {
  const Tabs = ({ children }: any) => <div>{children}</div>;
  const TabsList = ({ children }: any) => <div>{children}</div>;
  const TabsTrigger = ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  );
  const TabsContent = ({ children }: any) => <div>{children}</div>;
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});
vi.mock('@/services/advancedLiveData', () => {
  // Lightweight in-memory event bus
  const liveDataEvents = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as any;

  // Sample deterministic data
  const sampleMarketData = [
    {
      symbol: 'BTC_USDT',
      timestamp: 1700000000000,
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
      isAnomaly: false,
      confidence: 0,
    },
    {
      symbol: 'BTC_USDT',
      timestamp: 1700000060000,
      open: 50500,
      high: 51200,
      low: 50000,
      close: 50800,
      volume: 120,
      isAnomaly: true,
      confidence: 0.85,
    },
  ];

  // Plain object singleton with stubbed methods
  const liveDataService = {
    start: vi.fn(),
    stop: vi.fn(),
    fetchMarketData: vi.fn(async () => sampleMarketData),
    fetchOrderBook: vi.fn(async () => ({
      symbol: 'BTC_USDT',
      timestamp: 1700000000000,
      bids: [{ price: 50000, amount: 0.1, timestamp: 1700000000000 }],
      asks: [{ price: 50500, amount: 0.1, timestamp: 1700000000000 }],
      source: 'mock',
      lastUpdateId: 1,
    })),
    fetchTrades: vi.fn(async () => ([
      {
        id: '1',
        symbol: 'BTC_USDT',
        timestamp: 1700000000000,
        price: 50500,
        amount: 0.01,
        side: 'buy',
        source: 'mock',
      },
    ])),
    fetchMarketSummary: vi.fn(async () => ({
      symbol: 'BTC_USDT',
      timestamp: 1700000000000,
      lastPrice: 50500,
      bidPrice: 50490,
      askPrice: 50510,
      high24h: 52000,
      low24h: 48000,
      volume24h: 12345,
      quoteVolume24h: 987654,
      percentChange24h: 2.5,
      source: 'mock',
    })),
  } as any;

  // Export a factory so `new LiveDataService()` returns the singleton
  const LiveDataService = vi.fn(() => liveDataService);

  return {
    LiveDataService,
    liveDataService,
    liveDataEvents,
  } as any;
});
vi.mock('@/ml/mlTrading');
vi.mock('@/ml/dqnTrading');
vi.mock('@/ml/modelRecalibration');
// Mock recharts to lightweight passthroughs to avoid jsdom animation/RAF issues
vi.mock('recharts', () => {
  const Passthrough = (props: any) => (props && props.children) ?? null;
  const Line = () => null;
  const XAxis = () => null;
  const YAxis = () => null;
  const CartesianGrid = () => null;
  const Tooltip = () => null;
  const Legend = () => null;
  return {
    ResponsiveContainer: Passthrough,
    LineChart: Passthrough,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
  } as any;
});

describe('Advanced Features Tests', () => {
  // Ensure background timers/animations don't keep the event loop alive
  let rafSpy: any;
  let cafSpy: any;
  let setIntSpy: any;
  let clearIntSpy: any;
  let roBackup: any;
  let ioBackup: any;

  beforeAll(() => {
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback): number => {
        return window.setTimeout(() => cb(performance.now()), 0) as unknown as number;
      });
    cafSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id: number): void => {
        clearTimeout(id as unknown as number);
      });

    // Prevent real intervals from piling up
    setIntSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((_handler: TimerHandler, _timeout?: number, ..._args: any[]): any => {
        // return a dummy id without scheduling
        return 1 as any;
      });
    clearIntSpy = vi
      .spyOn(global, 'clearInterval')
      .mockImplementation((_id: any) => {});

    // Observer mocks to avoid jsdom issues
    roBackup = (global as any).ResizeObserver;
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
    ioBackup = (global as any).IntersectionObserver;
    (global as any).IntersectionObserver = class {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [] as number[];
    } as any;
  });

  afterAll(() => {
    rafSpy?.mockRestore();
    cafSpy?.mockRestore();
    setIntSpy?.mockRestore();
    clearIntSpy?.mockRestore();
    (global as any).ResizeObserver = roBackup;
    (global as any).IntersectionObserver = ioBackup;
  });

  // Use real timers; setInterval is stubbed to not schedule callbacks
  // LiveDataDashboard Tests
  describe('LiveDataDashboard', () => {
    beforeEach(() => {
      // no-op, service is mocked at module level
    });
    
    it('should render live data dashboard with market data', async () => {
      render(
        <MemoryRouter>
          <LiveDataDashboard />
        </MemoryRouter>
      );
      
      // Wait for heading to appear
      await screen.findByText(/Advanced Live Data Dashboard/i);
      
      // Market summary should be displayed (normalize whitespace, no comma)
      const priceMatches = screen.getAllByText((_, node) =>
        !!node?.textContent?.replace(/\s/g, '').includes('$50500.00')
      );
      const pctMatches = screen.getAllByText((_, node) =>
        !!node?.textContent?.replace(/\s/g, '').includes('+2.50%')
      );
      expect(priceMatches.length).toBeGreaterThan(0);
      expect(pctMatches.length).toBeGreaterThan(0);
      
      // Price chart should be rendered
      expect(screen.getByText(/Price Chart/i)).toBeInTheDocument();
      
      // Tabs should be available
      expect(screen.getByText(/Order Book/i)).toBeInTheDocument();
      expect(screen.getByText(/Recent Trades/i)).toBeInTheDocument();
      expect(screen.getByText(/Anomalies/i)).toBeInTheDocument();
      
      // Click on Order Book tab
      fireEvent.click(screen.getByText(/Order Book/i));
      
      // Order book data should be displayed (match formatted price text)
      const bidMatches = screen.getAllByText((_, node) =>
        !!node?.textContent?.replace(/\s/g, '').includes('50000.00')
      );
      const askMatches = screen.getAllByText((_, node) =>
        !!node?.textContent?.replace(/\s/g, '').includes('50500.00')
      );
      expect(bidMatches.length).toBeGreaterThan(0);
      expect(askMatches.length).toBeGreaterThan(0);
      
      // Click on Recent Trades tab
      fireEvent.click(screen.getByText(/Recent Trades/i));
      
      // Trade data should be displayed (mock includes a single BUY trade)
      expect(screen.getByText(/BUY/)).toBeInTheDocument();
      
      // Click on Anomalies tab
      fireEvent.click(screen.getByText(/Anomalies/i));
      
      // Anomaly data should be displayed
      expect(screen.getByText(/PRICE ANOMALY/)).toBeInTheDocument();
      expect(screen.getByText(/85%/)).toBeInTheDocument();
    });
    
    it('should handle live data service controls', async () => {
      // Mock service methods on singleton
      liveDataService.start = vi.fn();
      liveDataService.stop = vi.fn();
      
      render(
        <MemoryRouter>
          <LiveDataDashboard />
        </MemoryRouter>
      );
      
      // Wait for component to load
      await screen.findByText(/Advanced Live Data Dashboard/i);
      
      // Start button should be available
      const startButton = screen.getByText(/Start Live Data/i);
      expect(startButton).toBeInTheDocument();
      
      // Click start button
      fireEvent.click(startButton);
      
      // Service should be started
      expect(liveDataService.start).toHaveBeenCalled();
      
      // Button should change to Stop
      await screen.findByText(/Stop Live Data/i);
      
      // Click stop button
      fireEvent.click(screen.getByText(/Stop Live Data/i));
      
      // Service should be stopped
      expect(liveDataService.stop).toHaveBeenCalled();
    });
    
    it('should update configuration settings', async () => {
      render(
        <MemoryRouter>
          <LiveDataDashboard />
        </MemoryRouter>
      );
      
      // Wait for component to load
      await screen.findByText(/Advanced Live Data Dashboard/i);
      
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
  
});