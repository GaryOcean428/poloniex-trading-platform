import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { Strategy, StrategyType, MarketData, Trade } from '../types';
import { mockMarketData, mockTrades } from '../data/mockData';
import { usePoloniexData } from '../hooks/usePoloniexData';
import { poloniexApi } from '../services/poloniexAPI';
import { webSocketService } from '../services/websocketService';

interface TradingContextType {
  marketData: MarketData[];
  trades: Trade[];
  strategies: Strategy[];
  activeStrategies: string[];
  accountBalance: any;
  isLoading: boolean;
  isMockMode: boolean;
  addStrategy: (strategy: Strategy) => void;
  removeStrategy: (id: string) => void;
  toggleStrategyActive: (id: string) => void;
  placeOrder: (pair: string, side: 'buy' | 'sell', type: 'limit' | 'market', quantity: number, price?: number) => Promise<any>;
  errors: string[];
  addError: (error: string) => void;
  clearErrors: () => void;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

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
  
  const [marketData, setMarketData] = useState<MarketData[]>(mockMarketData);
  const [trades, setTrades] = useState<Trade[]>(mockTrades);
  
  // Update state when real data is available
  useEffect(() => {
    if (realMarketData.length > 0) {
      setMarketData(realMarketData);
    }
  }, [realMarketData]);
  
  useEffect(() => {
    if (realTrades.length > 0) {
      setTrades(realTrades);
    }
  }, [realTrades]);
  
  // Strategy management
  const [strategies, setStrategies] = useState<Strategy[]>([
    {
      id: '1',
      name: 'Moving Average Crossover',
      type: StrategyType.MA_CROSSOVER,
      parameters: {
        shortPeriod: 10,
        longPeriod: 50,
        pair: 'BTC-USDT'
      },
      created: new Date().toISOString(),
      performance: {
        totalPnL: 12.5,
        winRate: 0.65,
        tradesCount: 24
      }
    }
  ]);
  
  const [activeStrategies, setActiveStrategies] = useState<string[]>(['1']);
  const [errors, setErrors] = useState<string[]>([]);

  // If there was an error loading data, add it to our errors
  useEffect(() => {
    if (error) {
      addError(error);
    }
  }, [error]);

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

  const addError = (error: string) => {
    // Avoid adding duplicate errors
    setErrors(prev => {
      if (prev.includes(error)) {
        return prev;
      }
      return [...prev, error];
    });
  };

  const clearErrors = () => {
    setErrors([]);
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
        console.log('Using mock order placement', { pair, side, type, quantity, price });
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
      accountBalance,
      isLoading,
      isMockMode,
      refreshApiConnection,
      addStrategy,
      removeStrategy,
      toggleStrategyActive,
      placeOrder,
      errors,
      addError,
      clearErrors
    }}>
      {children}
    </TradingContext.Provider>
  );
};

export const useTradingContext = () => {
  const context = useContext(TradingContext);
  if (context === undefined) {
    throw new Error('useTradingContext must be used within a TradingProvider');
  }
  return context;
};