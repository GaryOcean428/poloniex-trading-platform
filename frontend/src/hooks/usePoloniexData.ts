import { useState, useEffect, useCallback, useRef } from 'react';
import { poloniexApi } from '@/services/poloniexAPI';
import { MarketData, Trade } from '@/types';
import { webSocketService } from '@/services/websocketService';
import { mockMarketData, mockTrades } from '@/data/mockData';
import { useSettings } from '@/hooks/useSettings';
import { shouldUseMockMode, IS_WEBCONTAINER } from '@/utils/environment';

interface PoloniexDataHook {
  marketData: MarketData[];
  trades: Trade[];
  accountBalance: unknown;
  isLoading: boolean;
  error: Error | null;
  isMockMode: boolean;
  fetchMarketData: (pair: string) => Promise<void>;
  fetchTrades: (pair: string) => Promise<void>;
  fetchAccountBalance: () => Promise<void>;
  refreshApiConnection: () => void;
}

export const usePoloniexData = (initialPair: string = 'BTC-USDT'): PoloniexDataHook => {
  const { apiKey, apiSecret, isLiveTrading } = useSettings();
  const [marketData, setMarketData] = useState<MarketData[]>(mockMarketData);
  const [trades, setTrades] = useState<Trade[]>(mockTrades);
  const [accountBalance, setAccountBalance] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Determine mock mode based on environment and credentials
  const hasCredentials = Boolean(apiKey && apiSecret);
  const [isMockMode, setIsMockMode] = useState<boolean>(shouldUseMockMode(hasCredentials));

  // Create refs to hold latest function references to avoid dependency issues
  const fetchFunctionsRef = useRef<{
    fetchMarketData: (pair: string) => Promise<void>;
    fetchTrades: (pair: string) => Promise<void>;
    fetchAccountBalance: () => Promise<void>;
  } | null>(null);

  // Helper function to map Poloniex data to MarketData format

  const mapPoloniexDataToMarketData = useCallback((data: unknown[]): MarketData[] => {
    try {
      return data
        .filter((item): item is Array<string | number> => Array.isArray(item) && item.length >= 6)
        .map((item) => ({
          pair: initialPair,
          timestamp: new Date(item[0] as string | number).getTime(),
          open: typeof item[1] === 'number' ? item[1] : parseFloat(String(item[1])),
          high: typeof item[2] === 'number' ? item[2] : parseFloat(String(item[2])),
          low: typeof item[3] === 'number' ? item[3] : parseFloat(String(item[3])),
          close: typeof item[4] === 'number' ? item[4] : parseFloat(String(item[4])),
          volume: typeof item[5] === 'number' ? item[5] : parseFloat(String(item[5]))
        }));
    } catch {
      return [];
    }
  }, [initialPair]);

  const mapPoloniexTradeToTrade = useCallback((tradeInput: unknown): Trade => {
    try {
      const t = (tradeInput || {}) as Record<string, unknown>;
      const toNum = (v: unknown): number => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : 0;
        }
        return 0;
      };
      const createdAt = t.createdAt;
      const ts =
        typeof createdAt === 'string' || typeof createdAt === 'number'
          ? new Date(createdAt).getTime()
          : Date.now();
      const qty = toNum(t.quantity);
      const price = toNum(t.price);

      return {
        id:
          typeof t.id === 'string'
            ? t.id
            : `generated-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        pair: initialPair,
        timestamp: ts,
        type: String(t.takerSide).toLowerCase() === 'buy' ? 'BUY' : 'SELL',
        price,
        amount: qty,
        total: price * qty,
        strategyId: '', // Not available from API
        status: 'COMPLETED'
      };
    } catch {
      return {
        id: `error-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        pair: initialPair,
        timestamp: Date.now(),
        type: 'BUY',
        price: 0,
        amount: 0,
        total: 0,
        strategyId: '',
        status: 'FAILED'
      };
    }
  }, [initialPair]);

  // Fetch functions defined before refreshApiConnection
  const fetchMarketData = useCallback(async (pair: string) => {
    // If in mock mode, use mock data immediately
    if (isMockMode) {
      if (import.meta.env.DEV) {
        console.info('Mock mode active, using mock market data');
      }
      setMarketData(mockMarketData);
      return;
    }

    // In WebContainer, use mock data for development
    if (IS_WEBCONTAINER) {
      if (import.meta.env.DEV) {
        console.info('WebContainer environment detected, using mock market data');
      }
      setMarketData(mockMarketData);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await poloniexApi.getMarketData(pair);

      if (data && Array.isArray(data)) {
        const formattedData = mapPoloniexDataToMarketData(data);
        if (formattedData.length > 0) {
          setMarketData(formattedData);
        } else {
          throw new Error('No market data returned from API');
        }
      } else {
        throw new Error('Invalid market data format received from API');
      }
    } catch (err) {
      const error = err as Error;
      // console.error('Error fetching market data:', error.message);
      setError(error);
      // Don't fall back to mock data - let the UI handle the error
    } finally {
      setIsLoading(false);
    }
  }, [isMockMode, mapPoloniexDataToMarketData]);

  const fetchTrades = useCallback(async (_pair: string) => {
    // If in mock mode, use mock data immediately
    if (isMockMode) {
      if (import.meta.env.DEV) {
        console.info('Mock mode active, using mock trades data');
      }
      setTrades(mockTrades);
      return;
    }

    // In WebContainer, use mock data for development
    if (IS_WEBCONTAINER) {
      if (import.meta.env.DEV) {
        console.info('WebContainer environment detected, using mock trades data');
      }
      setTrades(mockTrades);
      return;
    }

    setIsLoading(true);

    try {
      // Note: getRecentTrades method does not exist in current API, using placeholder
      // Use getRecentTrades method or fallback to empty array
      // Mock data for now since getRecentTrades doesn't exist
      const data: unknown[] = [];
      // console.log('Poloniex API method getRecentTrades not available, using mock data');

      if (data && Array.isArray(data)) {
        const formattedTrades = data.map(mapPoloniexTradeToTrade).filter(trade =>
          trade.id.indexOf('error-') !== 0 && !isNaN(trade.price) && !isNaN(trade.amount)
        );

        if (formattedTrades.length > 0) {
          setTrades(formattedTrades);
        } else {
          throw new Error('No valid trades returned from API');
        }
      } else {
        throw new Error('Invalid trades data format received from API');
      }
    } catch (err) {
      const error = err as Error;
      // console.error('Error fetching trades:', error.message);
      setError(error);
      // Don't fall back to mock data - let the UI handle the error
    } finally {
      setIsLoading(false);
    }
  }, [isMockMode, mapPoloniexTradeToTrade]);

  const fetchAccountBalance = useCallback(async () => {
    // If in mock mode, use mock data immediately
    if (isMockMode) {
      if (import.meta.env.DEV) {
        console.info('Mock mode active, using mock account data');
      }
      setAccountBalance({
        totalAmount: "15478.23",
        availableAmount: "12345.67",
        accountEquity: "15820.45",
        unrealizedPnL: "342.22",
        todayPnL: "156.78",
        todayPnLPercentage: "1.02"
      });
      return;
    }

    // In WebContainer, use mock data for development
    if (IS_WEBCONTAINER) {
      if (import.meta.env.DEV) {
        console.info('WebContainer environment detected, using mock account data');
      }
      setAccountBalance({
        totalAmount: "15478.23",
        availableAmount: "12345.67",
        accountEquity: "15820.45",
        unrealizedPnL: "342.22",
        todayPnL: "156.78",
        todayPnLPercentage: "1.02"
      });
      return;
    }

    setIsLoading(true);

    try {
      const data = await poloniexApi.getAccountBalance();
      setAccountBalance(data);
    } catch (err) {
      const error = err as Error;
      // console.error('Error fetching account balance:', error.message);
      setError(error);
      // Don't fall back to mock data - let the UI handle the error
    } finally {
      setIsLoading(false);
    }
  }, [isMockMode]);

  // Update function refs to latest versions
  fetchFunctionsRef.current = {
    fetchMarketData,
    fetchTrades,
    fetchAccountBalance
  };

  // Function to refresh API connection when settings change - defined after all dependencies
  const refreshApiConnection = useCallback(() => {
    if (import.meta.env.DEV) {
      console.info('Refreshing API connection with new credentials');
    }
    setIsLoading(true);
    poloniexApi.loadCredentials();

    // Clear any existing errors
    setError(null);

    // Refresh data with new credentials
    Promise.all([
      fetchMarketData(initialPair),
      fetchTrades(initialPair),
      fetchAccountBalance()
    ]).finally(() => {
      setIsLoading(false);
    });
  }, [initialPair, fetchMarketData, fetchTrades, fetchAccountBalance]);

  // Update mock mode when credentials change
  useEffect(() => {
    const newHasCredentials = Boolean(apiKey && apiSecret);
    const newMockMode = shouldUseMockMode(newHasCredentials) || !isLiveTrading;
    setIsMockMode(newMockMode);

    if (isLiveTrading && newHasCredentials && !newMockMode) {
      if (import.meta.env.DEV) {
        console.info('Live trading enabled with credentials, refreshing API connection');
      }
      poloniexApi.loadCredentials();

      // Manually trigger data refresh without causing dependency loop
      setIsLoading(true);
      setError(null);

      // Use the ref functions to avoid dependency loop
      if (fetchFunctionsRef.current) {
        Promise.all([
          fetchFunctionsRef.current.fetchMarketData(initialPair),
          fetchFunctionsRef.current.fetchTrades(initialPair),
          fetchFunctionsRef.current.fetchAccountBalance()
        ]).finally(() => {
          setIsLoading(false);
        });
      }
    } else {
      if (import.meta.env.DEV) {
        console.info('Using mock mode - live trading disabled or missing credentials');
      }
    }
  }, [isLiveTrading, apiKey, apiSecret, initialPair]);

  // Handle real-time updates via WebSocket
  useEffect(() => {
    // In WebContainer, skip WebSocket connection and use mock data immediately
    if (IS_WEBCONTAINER) {
      if (import.meta.env.DEV) {
        console.info('WebContainer environment detected, using mock data instead of WebSocket');
      }
      setIsMockMode(true);
      setMarketData(mockMarketData);
      setTrades(mockTrades);

      // Skip the rest of the WebSocket setup
      return () => {}; // Empty cleanup function
    }

    // Connect to WebSocket for non-WebContainer environments
    // Support both Promise-returning and void-returning connect implementations
    Promise.resolve(webSocketService.connect())
      .then(() => {
        if (import.meta.env.DEV) {
          console.info('WebSocket setup complete');
        }

        // Check if we're in mock mode from the WebSocket service
        setIsMockMode(webSocketService.isMockMode());

        // Only subscribe if connection was successful
        if (webSocketService.isConnected()) {
          webSocketService.subscribeToMarket(initialPair);
        } else {
          if (import.meta.env.DEV) {
            console.info('Using mock data mode');
          }
          // Initialize with mock data if WebSocket connection failed
          setMarketData(mockMarketData);
          setTrades(mockTrades);
        }
      })
      .catch(_err => {
        // console.error('Error connecting to WebSocket:', err instanceof Error ? err.message : String(err));
        setIsMockMode(true);
        setMarketData(mockMarketData);
        setTrades(mockTrades);
      });

    // Listen for market data updates with proper typing
    const handleMarketDataUpdate = (...args: unknown[]) => {
      const data = args[0] as MarketData;
      if (data?.pair === initialPair) {
        setMarketData(prevData => {
          // Find if this timestamp already exists
          const existingIndex = prevData.findIndex(item => item.timestamp === data.timestamp);

          if (existingIndex >= 0) {
            // Update existing data
            const updatedData = [...prevData];
            updatedData[existingIndex] = data;
            return updatedData;
          } else {
            // Add new data and maintain order
            const newData = [...prevData, data];
            return newData.sort((a, b) => a.timestamp - b.timestamp);
          }
        });
      }
    };

    // Listen for trade updates with proper typing
    const handleTradeUpdate = (...args: unknown[]) => {
      const trade = args[0] as Trade;
      if (trade?.pair === initialPair) {
        setTrades(prevTrades => {
          // Check if trade already exists
          if (!prevTrades.some(t => t.id === trade.id)) {
            return [trade, ...prevTrades].slice(0, 50); // Keep last 50 trades
          }
          return prevTrades;
        });
      }
    };

    webSocketService.on('marketData', handleMarketDataUpdate);
    webSocketService.on('tradeExecuted', handleTradeUpdate);

    // Initial data fetch with small delay to avoid overwhelming the browser
    setTimeout(() => {
      if (fetchFunctionsRef.current) {
        fetchFunctionsRef.current.fetchMarketData(initialPair);
        setTimeout(() => {
          if (fetchFunctionsRef.current) {
            fetchFunctionsRef.current.fetchTrades(initialPair);
            setTimeout(() => {
              if (fetchFunctionsRef.current) {
                fetchFunctionsRef.current.fetchAccountBalance();
              }
            }, 500);
          }
        }, 500);
      }
    }, 500);

    // Cleanup
    return () => {
      webSocketService.off('marketData', handleMarketDataUpdate);
      webSocketService.off('tradeExecuted', handleTradeUpdate);
      if (webSocketService.isConnected()) {
        webSocketService.unsubscribeFromMarket(initialPair);
      }
    };
  }, [initialPair]);

  return {
    marketData,
    trades,
    accountBalance,
    isLoading,
    error,
    isMockMode,
    fetchMarketData,
    fetchTrades,
    fetchAccountBalance,
    refreshApiConnection
  };
};
