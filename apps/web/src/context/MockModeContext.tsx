import { createContext, useState, useEffect, ReactNode } from 'react';
import { useSettings } from '../hooks/useSettings';

// Define the mock mode context type
export interface MockModeContextType {
  isMockMode: boolean;
  setMockMode: (value: boolean) => void;
  mockDataSource: 'random' | 'historical' | 'simulation';
  setMockDataSource: (source: 'random' | 'historical' | 'simulation') => void;
  mockDataDelay: number;
  setMockDataDelay: (delay: number) => void;
  mockVolatility: number;
  setMockVolatility: (volatility: number) => void;
  mockTrendBias: number;
  setMockTrendBias: (bias: number) => void;
  mockHistoricalPeriod: string;
  setMockHistoricalPeriod: (period: string) => void;
  mockDataOptions: {
    useRandomSeed: boolean;
    randomSeed: number;
    simulateLatency: boolean;
    simulateErrors: boolean;
    errorRate: number;
  };
  updateMockDataOptions: (options: Partial<MockModeContextType['mockDataOptions']>) => void;
  resetMockSettings: () => void;
}

// Default mock mode settings
const defaultMockSettings = {
  isMockMode: false,  // Production default: use real data
  mockDataSource: 'historical' as const,
  mockDataDelay: 1000,
  mockVolatility: 0.5,
  mockTrendBias: 0,
  mockHistoricalPeriod: '2023-01-01,2023-12-31',
  mockDataOptions: {
    useRandomSeed: false,
    randomSeed: 42,
    simulateLatency: true,
    simulateErrors: false,
    errorRate: 0.05
  }
};

// Create the context
const MockModeContext = createContext<MockModeContextType | undefined>(undefined);

export { MockModeContext };

// Provider component
interface MockModeProviderProps {
  children: ReactNode;
}

export const MockModeProvider: React.FC<MockModeProviderProps> = ({ children }) => {
  const settings = useSettings();
  
  // Initialize state from settings context
  const [isMockMode, setIsMockMode] = useState<boolean>(!settings.isLiveTrading);
  const [mockDataSource, setMockDataSource] = useState<'random' | 'historical' | 'simulation'>(
    defaultMockSettings.mockDataSource
  );
  const [mockDataDelay, setMockDataDelay] = useState<number>(defaultMockSettings.mockDataDelay);
  const [mockVolatility, setMockVolatility] = useState<number>(defaultMockSettings.mockVolatility);
  const [mockTrendBias, setMockTrendBias] = useState<number>(defaultMockSettings.mockTrendBias);
  const [mockHistoricalPeriod, setMockHistoricalPeriod] = useState<string>(
    defaultMockSettings.mockHistoricalPeriod
  );
  const [mockDataOptions, setMockDataOptions] = useState(defaultMockSettings.mockDataOptions);

  // Sync with settings context
  useEffect(() => {
    setIsMockMode(!settings.isLiveTrading);
  }, [settings.isLiveTrading]);

  // Update settings when mock mode changes
  useEffect(() => {
    settings.updateSettings({ isLiveTrading: !isMockMode });
  }, [isMockMode, settings]);

  // Update mock data options
  const updateMockDataOptions = (options: Partial<MockModeContextType['mockDataOptions']>) => {
    setMockDataOptions(prev => ({ ...prev, ...options }));
  };

  // Reset mock settings to default
  const resetMockSettings = () => {
    setMockDataSource(defaultMockSettings.mockDataSource);
    setMockDataDelay(defaultMockSettings.mockDataDelay);
    setMockVolatility(defaultMockSettings.mockVolatility);
    setMockTrendBias(defaultMockSettings.mockTrendBias);
    setMockHistoricalPeriod(defaultMockSettings.mockHistoricalPeriod);
    setMockDataOptions(defaultMockSettings.mockDataOptions);
  };

  // Set mock mode
  const setMockMode = (value: boolean) => {
    setIsMockMode(value);
  };

  return (
    <MockModeContext.Provider
      value={{
        isMockMode,
        setMockMode,
        mockDataSource,
        setMockDataSource,
        mockDataDelay,
        setMockDataDelay,
        mockVolatility,
        setMockVolatility,
        mockTrendBias,
        setMockTrendBias,
        mockHistoricalPeriod,
        setMockHistoricalPeriod,
        mockDataOptions,
        updateMockDataOptions,
        resetMockSettings
      }}
    >
      {children}
    </MockModeContext.Provider>
  );
};

// End of component
