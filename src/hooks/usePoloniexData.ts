import { useState, useEffect, useCallback } from 'react';
import { poloniexApi } from '@/services/poloniexAPI';
import { MarketData, Trade } from '@/types';
import { webSocketService } from '@/services/websocketService';
import { mockMarketData, mockTrades } from '@/data/mockData';
import { useSettings } from '@/context/SettingsContext';

// Check if we're running in a WebContainer environment
const IS_WEBCONTAINER = typeof window !== 'undefined' && window.location && window.location.hostname.includes('webcontainer-api.io');

interface PoloniexDataHook {
  marketData: MarketData[];
  trades: Trade[];
  accountBalance: any;
  isLoading: boolean;
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(true);
  
  // Force API refresh when live trading is toggled
  useEffect(() => {
    if (isLiveTrading && apiKey && apiSecret) {
      console.log('Live trading enabled, refreshing API connection');
      poloniexApi.loadCredentials();
      refreshApiConnection();
    } else {
      console.log('Live trading disabled or missing credentials');
      setIsMockMode(true);
    }
  }, [isLiveTrading, apiKey, apiSecret]);
  
  // Function to refresh API connection when settings change
  const refreshApiConnection = useCallback(() => {
    console.log('Refreshing API connection with new credentials');
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
  }, [initialPair]);
  
  // Monitor for changes in API credentials
  useEffect(() => {
    refreshApiConnection();
  }, [apiKey, apiSecret, isLiveTrading, refreshApiConnection]);
  
  const mapPoloniexDataToMarketData = (data: any[]): MarketData[] => {
    try {
      return data.map(item => ({
        pair: initialPair,
        timestamp: new Date(item[0]).getTime(),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5])
      }));
    } catch (err) {
      console.error('Error mapping Poloniex data:', err instanceof Error ? err.message : String(err));
      return [];
    }
  };
  
  const mapPoloniexTradeToTrade = (trade: any): Trade => {
    try {
      return {
        id: trade.id || `generated-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        pair: initialPair,
        timestamp: new Date(trade.createdAt).getTime(),
        type: trade.takerSide === 'buy' ? 'BUY' : 'SELL',
        price: parseFloat(trade.price),
        amount: parseFloat(trade.quantity),
        total: parseFloat(trade.price) * parseFloat(trade.quantity),
        strategyId: '', // Not available from API
        status: 'COMPLETED'
      };
    } catch (err) {
      console.error('Error mapping Poloniex trade:', err instanceof Error ? err.message : String(err));
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
  };
  
  const fetchMarketData = useCallback(async (pair: string) => {
    // In WebContainer, skip the actual API call and use mock data immediately
    if (IS_WEBCONTAINER) {
      console.log('WebContainer environment detected, using mock market data');
      setMarketData(mockMarketData);
      setIsMockMode(true);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Use AbortController to set a timeout for the fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const data = await poloniexApi.getMarketData(pair);
      clearTimeout(timeoutId);
      
      if (data && Array.isArray(data)) {
        const formattedData = mapPoloniexDataToMarketData(data);
        if (formattedData.length > 0) {
          setMarketData(formattedData);
          setIsMockMode(false);
        } else {
          setMarketData(mockMarketData);
          setIsMockMode(true);
        }
      } else {
        // If no data or invalid format, use mock data
        setMarketData(mockMarketData);
        setIsMockMode(true);
      }
    } catch (err) {
      // Don't set error state for timeout/abort errors, just fallback to mock data
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Market data request timed out, using mock data');
      } else if (!IS_WEBCONTAINER) {
        console.error('Error fetching market data:', err instanceof Error ? err.message : String(err));
        setError('Failed to fetch market data. Using demo data instead.');
      }
      
      setMarketData(mockMarketData);
      setIsMockMode(true);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const fetchTrades = useCallback(async (pair: string) => {
    // In WebContainer, skip the actual API call and use mock data immediately
    if (IS_WEBCONTAINER) {
      console.log('WebContainer environment detected, using mock trades data');
      setTrades(mockTrades);
      setIsMockMode(true);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Use AbortController to set a timeout for the fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const data = await poloniexApi.getRecentTrades(pair);
      clearTimeout(timeoutId);
      
      if (data && Array.isArray(data)) {
        const formattedTrades = data.map(mapPoloniexTradeToTrade).filter(trade => 
          trade.id.indexOf('error-') !== 0 && !isNaN(trade.price) && !isNaN(trade.amount)
        );
        
        if (formattedTrades.length > 0) {
          setTrades(formattedTrades);
          setIsMockMode(false);
        } else {
          setTrades(mockTrades);
          setIsMockMode(true);
        }
      } else {
        // If no data or invalid format, use mock data
        setTrades(mockTrades);
        setIsMockMode(true);
      }
    } catch (err) {
      // Don't set error state for timeout/abort errors, just fallback to mock data
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Trades request timed out, using mock data');
      } else if (!IS_WEBCONTAINER) {
        console.error('Error fetching trades:', err instanceof Error ? err.message : String(err));
      }
      
      setTrades(mockTrades);
      setIsMockMode(true);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const fetchAccountBalance = useCallback(async () => {
    // In WebContainer, skip the actual API call and use mock data immediately
    if (IS_WEBCONTAINER) {
      console.log('WebContainer environment detected, using mock account data');
      setAccountBalance({
        totalAmount: "15478.23",
        availableAmount: "12345.67",
        accountEquity: "15820.45",
        unrealizedPnL: "342.22",
        todayPnL: "156.78",
        todayPnLPercentage: "1.02"
      });
      setIsMockMode(true);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Use AbortController to set a timeout for the fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const data = await poloniexApi.getAccountBalance();
      clearTimeout(timeoutId);
      
      setAccountBalance(data);
      setIsMockMode(false);
    } catch (err) {
      // Don't set error state for timeout/abort errors, just fallback to mock data
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Account balance request timed out, using mock data');
      } else if (!IS_WEBCONTAINER) {
        console.error('Error fetching account balance:', err instanceof Error ? err.message : String(err));
      }
      
      // Set default mock balance
      setAccountBalance({
        totalAmount: "15478.23",
        availableAmount: "12345.67",
        accountEquity: "15820.45",
        unrealizedPnL: "342.22",
        todayPnL: "156.78",
        todayPnLPercentage: "1.02"
      });
      setIsMockMode(true);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Handle real-time updates via WebSocket
  useEffect(() => {
    // In WebContainer, skip WebSocket connection and use mock data immediately
    if (IS_WEBCONTAINER) {
      console.log('WebContainer environment detected, using mock data instead of WebSocket');
      setIsMockMode(true);
      setMarketData(mockMarketData);
      setTrades(mockTrades);
      
      // Skip the rest of the WebSocket setup
      return () => {}; // Empty cleanup function
    }
    
    // Connect to WebSocket for non-WebContainer environments
    webSocketService.connect()
      .then(() => {
        console.log('WebSocket setup complete');
        
        // Check if we're in mock mode from the WebSocket service
        setIsMockMode(webSocketService.isMockMode());
        
        // Only subscribe if connection was successful
        if (webSocketService.isConnected()) {
          webSocketService.subscribeToMarket(initialPair);
        } else {
          console.log('Using mock data mode');
          // Initialize with mock data if WebSocket connection failed
          setMarketData(mockMarketData);
          setTrades(mockTrades);
        }
      })
      .catch(err => {
        console.error('Error connecting to WebSocket:', err instanceof Error ? err.message : String(err));
        setIsMockMode(true);
        setMarketData(mockMarketData);
        setTrades(mockTrades);
      });
    
    // Listen for market data updates
    const handleMarketDataUpdate = (data: MarketData) => {
      if (data.pair === initialPair) {
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
    
    // Listen for trade updates
    const handleTradeUpdate = (trade: Trade) => {
      if (trade.pair === initialPair) {
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
      fetchMarketData(initialPair);
      setTimeout(() => {
        fetchTrades(initialPair);
        setTimeout(() => {
          fetchAccountBalance();
        }, 500);
      }, 500);
    }, 500);
    
    // Cleanup
    return () => {
      webSocketService.off('marketData', handleMarketDataUpdate);
      webSocketService.off('tradeExecuted', handleTradeUpdate);
      if (webSocketService.isConnected()) {
        webSocketService.unsubscribeFromMarket(initialPair);
      }
    };
  }, [initialPair, fetchMarketData, fetchTrades, fetchAccountBalance]);
  
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
