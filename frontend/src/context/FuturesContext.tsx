import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import PoloniexFuturesAPI, { 
  PositionMode, 
  MarginMode, 
  FuturesPosition, 
  FuturesAccountBalance 
} from '@/services/poloniexFuturesAPI';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';

interface FuturesContextType {
  api: PoloniexFuturesAPI;
  positions: FuturesPosition[];
  accountBalance: FuturesAccountBalance | null;
  positionMode: PositionMode;
  isLoading: boolean;
  error: string | null;
  refreshPositions: () => Promise<void>;
  refreshAccountBalance: () => Promise<void>;
  setPositionMode: (mode: PositionMode) => Promise<void>;
  setLeverage: (symbol: string, leverage: string, marginMode: MarginMode) => Promise<void>;
}

const defaultFuturesContext: FuturesContextType = {
  api: new PoloniexFuturesAPI(true), // Default to mock mode
  positions: [],
  accountBalance: null,
  positionMode: PositionMode.ONE_WAY,
  isLoading: false,
  error: null,
  refreshPositions: async () => {},
  refreshAccountBalance: async () => {},
  setPositionMode: async () => {},
  setLeverage: async () => {}
};

const FuturesContext = createContext<FuturesContextType>(defaultFuturesContext);

export { FuturesContext };

interface FuturesProviderProps {
  children: ReactNode;
}

export const FuturesProvider: React.FC<FuturesProviderProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const { mockMode } = useSettings();
  
  const [api] = useState<PoloniexFuturesAPI>(() => new PoloniexFuturesAPI(mockMode));
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [accountBalance, setAccountBalance] = useState<FuturesAccountBalance | null>(null);
  const [positionMode, setPositionModeState] = useState<PositionMode>(PositionMode.ONE_WAY);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh positions data
  const refreshPositions = useCallback(async () => {
    if (!isAuthenticated && !mockMode) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const positions = await api.getCurrentPositions();
      setPositions(positions);
    } catch (err) {
      // console.error('Failed to fetch positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, mockMode, api]);

  // Refresh account balance
  const refreshAccountBalance = useCallback(async () => {
    if (!isAuthenticated && !mockMode) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const balance = await api.getAccountBalance();
      setAccountBalance(balance);
    } catch (err) {
      // console.error('Failed to fetch account balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch account balance');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, mockMode, api]);

  // Set position mode (Hedge or One-way)
  const setPositionMode = async (mode: PositionMode) => {
    if (!isAuthenticated && !mockMode) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      await api.switchPositionMode(mode);
      setPositionModeState(mode);
    } catch (err) {
      // console.error('Failed to set position mode:', err);
      setError(err instanceof Error ? err.message : 'Failed to set position mode');
    } finally {
      setIsLoading(false);
    }
  };

  // Set leverage for a symbol
  const setLeverage = async (symbol: string, leverage: string, marginMode: MarginMode) => {
    if (!isAuthenticated && !mockMode) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      await api.setLeverage({ symbol, lever: leverage, mgnMode: marginMode });
      // Refresh positions to get updated leverage
      await refreshPositions();
    } catch (err) {
      // console.error('Failed to set leverage:', err);
      setError(err instanceof Error ? err.message : 'Failed to set leverage');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch initial data when authenticated or in mock mode
  useEffect(() => {
    if (isAuthenticated || mockMode) {
      const fetchInitialData = async () => {
        setIsLoading(true);
        setError(null);
        
        try {
          // Get position mode
          const modeResponse = await api.getPositionMode();
          setPositionModeState(modeResponse.posMode);
          
          // Get positions and account balance
          await Promise.all([
            refreshPositions(),
            refreshAccountBalance()
          ]);
        } catch (err) {
          // console.error('Failed to fetch initial futures data:', err);
          setError(err instanceof Error ? err.message : 'Failed to fetch initial futures data');
        } finally {
          setIsLoading(false);
        }
      };
      
      fetchInitialData();
    }
  }, [api, refreshAccountBalance, refreshPositions, isAuthenticated, mockMode]);

  // Refresh data periodically
  useEffect(() => {
    if (!isAuthenticated && !mockMode) return;
    
    const refreshInterval = setInterval(() => {
      refreshPositions();
      refreshAccountBalance();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(refreshInterval);
  }, [refreshAccountBalance, refreshPositions, isAuthenticated, mockMode]);

  const value = {
    api,
    positions,
    accountBalance,
    positionMode,
    isLoading,
    error,
    refreshPositions,
    refreshAccountBalance,
    setPositionMode,
    setLeverage
  };

  return (
    <FuturesContext.Provider value={value}>
      {children}
    </FuturesContext.Provider>
  );
};
