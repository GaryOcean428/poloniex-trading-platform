import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { usePoloniexData } from '../hooks/usePoloniexData';
import { TradingProvider } from '../context/TradingContext';
import { SettingsProvider } from '../context/SettingsContext';
import { WebSocketProvider } from '../context/WebSocketContext';

// Mock the services and utilities
vi.mock('../services/poloniexAPI', () => ({
  poloniexApi: {
    loadCredentials: vi.fn(),
    getMarketData: vi.fn().mockResolvedValue([]),
    getRecentTrades: vi.fn().mockResolvedValue([]),
    getAccountBalance: vi.fn().mockResolvedValue({}),
    placeOrder: vi.fn().mockResolvedValue({ success: true, orderId: 'test-order' })
  }
}));

vi.mock('../services/websocketService', () => ({
  webSocketService: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
    isMockMode: vi.fn().mockReturnValue(true),
    subscribeToMarket: vi.fn(),
    unsubscribeFromMarket: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    handlePageVisibilityChange: vi.fn()
  }
}));

vi.mock('../hooks/usePageVisibility', () => ({
  usePageVisibility: vi.fn()
}));

vi.mock('../utils/environment', () => ({
  shouldUseMockMode: vi.fn().mockReturnValue(true),
  IS_WEBCONTAINER: false
}));

vi.mock('../hooks/useSettings', () => ({
  useSettings: vi.fn().mockReturnValue({
    apiKey: '',
    apiSecret: '',
    isLiveTrading: false
  })
}));

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <SettingsProvider>
      <WebSocketProvider>
        <TradingProvider>
          {children}
        </TradingProvider>
      </WebSocketProvider>
    </SettingsProvider>
  </BrowserRouter>
);

describe('React Error #185 Fix - Infinite Loop Prevention', () => {
  const renderCount = 0;
  
  beforeEach(() => {
    renderCount = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should not cause infinite re-renders in usePoloniexData hook', async () => {
    const { result } = renderHook(
      () => {
        renderCount++;
        return usePoloniexData('BTC-USDT');
      },
      { wrapper: TestWrapper }
    );

    // Wait for initial effects to complete
    await waitFor(() => {
      expect(result.current.isMockMode).toBe(true);
    }, { timeout: 2000 });

    // Check that renders are reasonable (not infinite)
    expect(renderCount).toBeLessThan(10);
    
    // Should have loaded mock data
    expect(result.current.marketData).toBeDefined();
    expect(result.current.trades).toBeDefined();
  });

  it('should handle credential changes without infinite loops', async () => {
    const mockUseSettings = vi.mocked(await import('../hooks/useSettings')).useSettings;
    
    // Start with no credentials
    mockUseSettings.mockReturnValue({
      apiKey: '',
      apiSecret: '',
      isLiveTrading: false,
      darkMode: false,
      defaultPair: 'BTC-USDT',
      emailNotifications: false,
      tradeNotifications: false,
      riskLevel: 'medium',
      maxPositionSize: 100,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      leverage: 1,
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      exportSettings: vi.fn(),
      importSettings: vi.fn(),
      validateApiCredentials: vi.fn(),
      getApiStatus: vi.fn(),
      theme: 'light',
      language: 'en'
    } as any);

    const { result, rerender } = renderHook(
      () => {
        renderCount++;
        return usePoloniexData('BTC-USDT');
      },
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isMockMode).toBe(true);
    });

    const initialRenderCount = renderCount;

    // Change credentials - this should not trigger infinite re-renders
    mockUseSettings.mockReturnValue({
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      isLiveTrading: true,
      darkMode: false,
      defaultPair: 'BTC-USDT',
      emailNotifications: false,
      tradeNotifications: false,
      riskLevel: 'medium',
      maxPositionSize: 100,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      leverage: 1,
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
      exportSettings: vi.fn(),
      importSettings: vi.fn(),
      validateApiCredentials: vi.fn(),
      getApiStatus: vi.fn(),
      theme: 'light',
      language: 'en'
    } as any);

    rerender();

    // Wait for effects to settle
    await waitFor(() => {
      // Should still be reasonable number of renders
      expect(renderCount - initialRenderCount).toBeLessThan(5);
    }, { timeout: 1000 });

    expect(renderCount).toBeLessThan(20); // Overall sanity check
  });

  it('should not cause infinite loops in TradingProvider error handling', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const TestComponent = () => {
      renderCount++;
      return <div>Test</div>;
    };

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for providers to initialize
    await waitFor(() => {
      expect(renderCount).toBeGreaterThan(0);
    });

    // Should not have excessive renders
    expect(renderCount).toBeLessThan(15);

    consoleSpy.mockRestore();
  });

  it('should handle WebSocket connection states without infinite loops', async () => {
    const { webSocketService } = await import('../services/websocketService');
    
    render(
      <TestWrapper>
        <div>WebSocket Test</div>
      </TestWrapper>
    );

    // Wait for initial connection attempts
    await waitFor(() => {
      expect(webSocketService.connect).toHaveBeenCalled();
    });

    // WebSocket service should be set up without infinite calls (allow multiple calls for different components)
    expect(webSocketService.connect).toHaveBeenCalledTimes(2);
  });

  it('should prevent React Error #185 with maximum update depth exceeded', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errorThrown = false;

    try {
      const { result } = renderHook(
        () => {
          renderCount++;
          if (renderCount > 100) {
            throw new Error('Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.');
          }
          return usePoloniexData('BTC-USDT');
        },
        { wrapper: TestWrapper }
      );

      await waitFor(() => {
        expect(result.current.isMockMode).toBeDefined();
      }, { timeout: 3000 });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Maximum update depth exceeded')) {
        errorThrown = true;
      }
    }

    // Should not throw the React Error #185
    expect(errorThrown).toBe(false);
    expect(renderCount).toBeLessThan(100);

    errorSpy.mockRestore();
  });
});