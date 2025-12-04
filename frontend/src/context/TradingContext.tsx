import React, { createContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { Strategy, _MovingAverageCrossoverParameters} from '@shared/types';
import { MarketData, Trade } from '../types';
import { mockMarketData, mockTrades } from '../data/mockData';
import { usePoloniexData } from '../hooks/usePoloniexData';
import { poloniexApi } from '../services/poloniexAPI';
import { isValidAccountBalance } from '../utils/typeGuards';

interface TradingContextType {
  marketData: MarketData[];
  trades: Trade[];
  strategies: Strategy[];
  activeStrategies: string[];
  accountBalance: {
    available: number;
    total: number;
    currency: string;
  } | null;
  isLoading: boolean;
  isMockMode: boolean;
  addStrategy: (strategy: Strategy) => void;
  removeStrategy: (id: string) => void;
  toggleStrategyActive: (id: string) => void;
  placeOrder: (pair: string, side: 'buy' | 'sell', type: 'limit' | 'market', quantity: number, price?: number) => Promise<unknown>;
  errors: string[];
  addError: (error: string) => void;
  clearErrors: () => void;
  refreshApiConnection: () => void; // Changed to non-Promise return type to match implementation
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export { TradingContext };

interface TradingProviderProps {
  children: ReactNode;
  initialPair?: string;
}

export const TradingProvider: React.FC<TradingProviderProps> = ({
  children,
  initialPair = 'BTC-USDT'
}) => {
  // Get data from Poloniex API or mock data
  const {
    marketData: realMarketData,
    trades: realTrades,
    accountBalance,
    isLoading,
    error,
    isMockMode,
    refreshApiConnection
  } = usePoloniexData(initialPair);

  const normalizedAccountBalance = isValidAccountBalance(accountBalance) ? accountBalance : null;

  // Use real data or fallback to mock only in mock mode, otherwise use empty arrays
  const [marketData, setMarketData] = useState<MarketData[]>(isMockMode ? mockMarketData : []);
  const [trades, setTrades] = useState<Trade[]>(isMockMode ? mockTrades : []);

  // Update state when real data is available
  useEffect(() => {
    if (realMarketData.length > 0) {
      setMarketData(realMarketData);
    } else if (!isMockMode) {
      // Clear mock data when not in mock mode and no real data
      setMarketData([]);
    }
  }, [realMarketData, isMockMode]);

  useEffect(() => {
    if (realTrades.length > 0) {
      setTrades(realTrades);
    } else if (!isMockMode) {
      // Clear mock trades when not in mock mode and no real data
      setTrades([]);
    }
  }, [realTrades, isMockMode]);

  // Strategy management - start with empty array, strategies should be created/loaded from API
  const [strategies, setStrategies] = useState<Strategy[]>([]);

  const [activeStrategies, setActiveStrategies] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const addError = useCallback((error: string) => {
    // Avoid adding duplicate errors
    setErrors(prev => {
      if (prev.includes(error)) {
        return prev;
      }
      return [...prev, error];
    });
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  // If there was an error loading data, add it to our errors
  useEffect(() => {
    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addError(errorMessage);
    }
  }, [error, addError]);

  const addStrategy = (strategy: Strategy) => {
    setStrategies(prev => [...prev, strategy]);
  };

  const removeStrategy = (id: string) => {
    setStrategies(prev => prev.filter(strategy => strategy.id !== id));
    setActiveStrategies(prev => prev.filter(strategyId => strategyId !== id));
  };

  const toggleStrategyActive = (id: string) => {
    setActiveStrategies(prev =>
      prev.includes(id)
        ? prev.filter(strategyId => strategyId !== id)
        : [...prev, id]
    );
  };

  // Place an order using the Poloniex API
  const placeOrder = async (
    pair: string,
    side: 'buy' | 'sell',
    type: 'limit' | 'market',
    quantity: number,
    price?: number
  ) => {
    try {
      if (isMockMode) {
        // console.log('Using mock order placement', { pair, side, type, quantity, price });
        return {
          success: true,
          orderId: 'mock-order-' + Date.now(),
          pair,
          side,
          type,
          quantity,
          price: price || 'market'
        };
      }

      const result = await poloniexApi.placeOrder(pair, side, type, quantity, price);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error placing order';
      addError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  return (
    <TradingContext.Provider value={{
      marketData,
      trades,
      strategies,
      activeStrategies,
      accountBalance: normalizedAccountBalance,
      isLoading,
      isMockMode,
      addStrategy,
      removeStrategy,
      toggleStrategyActive,
      placeOrder,
      errors,
      addError,
      clearErrors,
      refreshApiConnection
    }}>
      {children}
    </TradingContext.Provider>
  );
};

// End of component
