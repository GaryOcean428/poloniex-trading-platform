import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select, SelectOption } from '@/components/ui/Select';
import { poloniexApi } from '@/services/poloniexAPI';
import { MarketData, Strategy, TradingStrategy } from '@/types';
import { getExtensionData, isChromeExtensionAvailable, setExtensionData } from '@/utils/chromeExtension';
import { executeStrategy } from '@/utils/strategyExecutors';
import { useEffect, useState } from 'react';
import { useSettings } from '../../hooks/useSettings';

// Strategy types
export type StrategyType = 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom';

// Strategy parameters interfaces
interface BaseParameters {
  pair: string;
  timeframe: string;
}

interface MovingAverageCrossoverParameters extends BaseParameters {
  fastPeriod: number;
  slowPeriod: number;
}

interface RSIParameters extends BaseParameters {
  period: number;
  overbought: number;
  oversold: number;
}

interface MACDParameters extends BaseParameters {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}

interface BollingerBandsParameters extends BaseParameters {
  period: number;
  stdDev: number;
}

interface CustomParameters extends BaseParameters {
  // Add any custom parameters here
  lookbackPeriod: number;
  breakoutThreshold: number;
}

// Union type for all parameter types
export type StrategyParameters =
  | MovingAverageCrossoverParameters
  | RSIParameters
  | MACDParameters
  | BollingerBandsParameters
  | CustomParameters;

// Test result interface
interface TestResult {
  signal: 'BUY' | 'SELL' | null;
  reason: string;
  confidence: number;
}

const StrategyBuilder: React.FC = () => {
  const { defaultPair, timeframe } = useSettings();

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [newStrategy, setNewStrategy] = useState<Partial<Strategy>>({
    id: '',
    name: '',
    type: 'MovingAverageCrossover',
    parameters: {
      pair: defaultPair,
      timeframe: timeframe,
      fastPeriod: 9,
      slowPeriod: 21
    } as StrategyParameters
  });
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load saved strategies from storage
  useEffect(() => {
    const loadStrategies = async () => {
      try {
        if (isChromeExtensionAvailable()) {
          // Load from Chrome storage if in extension
          getExtensionData('trading_strategies')
            .then((data: unknown) => {
              const strategies = data as Strategy[] | null;
              if (strategies) {
                setStrategies(strategies);
              }
            })
            .catch(err => console.error('Failed to load strategies from extension:', err));
        } else {
          // Load from localStorage if in browser
          const savedStrategies = localStorage.getItem('trading_strategies');
          if (savedStrategies) {
            setStrategies(JSON.parse(savedStrategies));
          }
        }
      } catch (err) {
        console.error('Failed to load saved strategies:', err);
      }
    };

    loadStrategies();
  }, []);

  // Save strategies to storage when they change
  useEffect(() => {
    if (strategies.length > 0) {
      try {
        if (isChromeExtensionAvailable()) {
          // Save to Chrome storage if in extension
          setExtensionData('trading_strategies', strategies)
            .catch(err => console.error('Failed to save strategies to extension:', err));
        } else {
          // Save to localStorage if in browser
          localStorage.setItem('trading_strategies', JSON.stringify(strategies));
        }
      } catch (err) {
        console.error('Failed to save strategies:', err);
      }
    }
  }, [strategies]);

  // Load market data for testing
  const loadMarketData = async () => {
    setIsLoading(true);
    setError(null);

    try
    {
      const pair = (newStrategy.parameters as BaseParameters)?.pair || defaultPair;
      const data = await poloniexApi.getMarketData(pair);
      setMarketData(data);
    } catch (err)
    {
      setError('Failed to load market data');
      // console.error(err);
    } finally
    {
      setIsLoading(false);
    }
  };

  // Test strategy with current market data
  const testStrategy = () => {
    if (!newStrategy.type || !marketData.length)
    {
      setError('Strategy or market data not available');
      return;
    }

    try
    {
      const strategyWithDefaults: TradingStrategy = {
        ...newStrategy,
        active: true,
        id: newStrategy.id || '',
        name: newStrategy.name || '',
        type: newStrategy.type || 'manual',
        parameters: newStrategy.parameters || {}
      } as TradingStrategy;
      const result = executeStrategy(strategyWithDefaults, marketData);
      setTestResult(result);
    } catch (err)
    {
      setError('Failed to execute strategy');
      // console.error(err);
    }
  };

  // Save new strategy
  const saveStrategy = () => {
    if (!newStrategy.id || !newStrategy.name || !newStrategy.type)
    {
      setError('Strategy ID, name, and type are required');
      return;
    }

    // Check if ID already exists
    if (strategies.some(s => s.id === newStrategy.id))
    {
      setError('Strategy ID already exists');
      return;
    }

    const strategy = {
      ...newStrategy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as Strategy;

    setStrategies([...strategies, strategy]);
    resetNewStrategy();
    setError(null);
  };

  // Delete strategy
  const deleteStrategy = (id: string) => {
    setStrategies(strategies.filter(s => s.id !== id));
  };

  // Select strategy for editing
  const selectStrategy = (strategy: Strategy) => {
    setSelectedStrategy(strategy);
    setNewStrategy(strategy);
  };

  // Reset new strategy form
  const resetNewStrategy = () => {
    setNewStrategy({
      id: '',
      name: '',
      type: 'MovingAverageCrossover',
      parameters: {
        pair: defaultPair,
        timeframe: timeframe,
        fastPeriod: 9,
        slowPeriod: 21
      } as StrategyParameters
    });
    setSelectedStrategy(null);
  };

  // Update strategy parameters based on type
  const updateStrategyType = (type: StrategyType) => {
    let parameters: StrategyParameters;

    switch (type)
    {
      case 'MovingAverageCrossover':
        parameters = {
          pair: defaultPair,
          timeframe,
          fastPeriod: 9,
          slowPeriod: 21
        } as MovingAverageCrossoverParameters;
        break;
      case 'RSI':
        parameters = {
          pair: defaultPair,
          timeframe,
          period: 14,
          overbought: 70,
          oversold: 30
        } as RSIParameters;
        break;
      case 'MACD':
        parameters = {
          pair: defaultPair,
          timeframe,
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9
        } as MACDParameters;
        break;
      case 'BollingerBands':
        parameters = {
          pair: defaultPair,
          timeframe,
          period: 20,
          stdDev: 2
        } as BollingerBandsParameters;
        break;
      default:
        parameters = {
          pair: defaultPair,
          timeframe,
          lookbackPeriod: 20,
          breakoutThreshold: 2
        } as CustomParameters;
    }

    setNewStrategy({
      ...newStrategy,
      type,
      parameters
    });
  };

  // Render parameter inputs based on strategy type
  const renderParameterInputs = () => {
    const type = newStrategy.type as StrategyType;
    const parameters = newStrategy.parameters || {};

    switch (type)
    {
      case 'MovingAverageCrossover': {
        const params = parameters as MovingAverageCrossoverParameters;
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="fastPeriod">Fast Period</Label>
              <Input
                id="fastPeriod"
                type="number"
                value={params.fastPeriod || 9}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    fastPeriod: parseInt(e.target.value)
                  } as MovingAverageCrossoverParameters
                })}
                min="2"
                max="50"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="slowPeriod">Slow Period</Label>
              <Input
                id="slowPeriod"
                type="number"
                value={params.slowPeriod || 21}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    slowPeriod: parseInt(e.target.value)
                  } as MovingAverageCrossoverParameters
                })}
                min="5"
                max="200"
              />
            </div>
          </>
        );
      }

      case 'RSI': {
        const params = parameters as RSIParameters;
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="period">RSI Period</Label>
              <Input
                id="period"
                type="number"
                value={params.period || 14}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    period: parseInt(e.target.value)
                  } as RSIParameters
                })}
                min="2"
                max="50"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="overbought">Overbought Level</Label>
              <Input
                id="overbought"
                type="number"
                value={params.overbought || 70}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    overbought: parseInt(e.target.value)
                  } as RSIParameters
                })}
                min="50"
                max="90"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="oversold">Oversold Level</Label>
              <Input
                id="oversold"
                type="number"
                value={params.oversold || 30}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    oversold: parseInt(e.target.value)
                  } as RSIParameters
                })}
                min="10"
                max="50"
              />
            </div>
          </>
        );
      }

      case 'MACD': {
        const params = parameters as MACDParameters;
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="fastPeriod">Fast Period</Label>
              <Input
                id="fastPeriod"
                type="number"
                value={params.fastPeriod || 12}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    fastPeriod: parseInt(e.target.value)
                  } as MACDParameters
                })}
                min="2"
                max="50"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="slowPeriod">Slow Period</Label>
              <Input
                id="slowPeriod"
                type="number"
                value={params.slowPeriod || 26}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    slowPeriod: parseInt(e.target.value)
                  } as MACDParameters
                })}
                min="5"
                max="100"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="signalPeriod">Signal Period</Label>
              <Input
                id="signalPeriod"
                type="number"
                value={params.signalPeriod || 9}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    signalPeriod: parseInt(e.target.value)
                  } as MACDParameters
                })}
                min="2"
                max="50"
              />
            </div>
          </>
        );
      }

      case 'BollingerBands': {
        const params = parameters as BollingerBandsParameters;
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="period">Period</Label>
              <Input
                id="period"
                type="number"
                value={params.period || 20}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    period: parseInt(e.target.value)
                  } as BollingerBandsParameters
                })}
                min="5"
                max="100"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="stdDev">Standard Deviations</Label>
              <Input
                id="stdDev"
                type="number"
                value={params.stdDev || 2}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    stdDev: parseFloat(e.target.value)
                  } as BollingerBandsParameters
                })}
                min="0.5"
                max="4"
                step="0.1"
              />
            </div>
          </>
        );
      }

      case 'Custom': {
        const params = parameters as CustomParameters;
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="lookbackPeriod">Lookback Period</Label>
              <Input
                id="lookbackPeriod"
                type="number"
                value={params.lookbackPeriod || 20}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    lookbackPeriod: parseInt(e.target.value)
                  } as CustomParameters
                })}
                min="5"
                max="100"
              />
            </div>
            <div className="mb-4">
              <Label htmlFor="breakoutThreshold">Breakout Threshold</Label>
              <Input
                id="breakoutThreshold"
                type="number"
                value={params.breakoutThreshold || 2}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...parameters,
                    breakoutThreshold: parseFloat(e.target.value)
                  } as CustomParameters
                })}
                min="0.5"
                max="5"
                step="0.1"
              />
            </div>
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="w-full">
        <div className="p-4 border-b">
          <h3 className="text-lg font-medium">Strategy Builder</h3>
        </div>
        <div className="p-4">
          {error && (
            <div className="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="strategyId">Strategy ID</Label>
              <Input
                id="strategyId"
                value={newStrategy.id || ''}
                onChange={(e) => setNewStrategy({ ...newStrategy, id: e.target.value })}
                placeholder="unique-strategy-id"
                disabled={!!selectedStrategy}
              />
            </div>

            <div>
              <Label htmlFor="strategyName">Strategy Name</Label>
              <Input
                id="strategyName"
                value={newStrategy.name || ''}
                onChange={(e) => setNewStrategy({ ...newStrategy, name: e.target.value })}
                placeholder="My Trading Strategy"
              />
            </div>

            <div>
              <Label htmlFor="strategyType">Strategy Type</Label>
              <Select
                id="strategyType"
                value={newStrategy.type || 'MovingAverageCrossover'}
                onChange={(e) => updateStrategyType(e.target.value as StrategyType)}
              >
                <SelectOption value="MovingAverageCrossover">Moving Average Crossover</SelectOption>
                <SelectOption value="RSI">Relative Strength Index (RSI)</SelectOption>
                <SelectOption value="MACD">MACD</SelectOption>
                <SelectOption value="BollingerBands">Bollinger Bands</SelectOption>
                <SelectOption value="Custom">Custom</SelectOption>
              </Select>
            </div>

            <div>
              <Label htmlFor="pair">Trading Pair</Label>
              <Input
                id="pair"
                value={(newStrategy.parameters as BaseParameters)?.pair || defaultPair}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...newStrategy.parameters,
                    pair: e.target.value
                  } as StrategyParameters
                })}
                placeholder="BTC-USDT"
              />
            </div>

            <div>
              <Label htmlFor="timeframe">Timeframe</Label>
              <Select
                id="timeframe"
                value={(newStrategy.parameters as BaseParameters)?.timeframe || timeframe}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: {
                    ...newStrategy.parameters,
                    timeframe: e.target.value
                  } as StrategyParameters
                })}
              >
                <SelectOption value="1m">1 Minute</SelectOption>
                <SelectOption value="5m">5 Minutes</SelectOption>
                <SelectOption value="15m">15 Minutes</SelectOption>
                <SelectOption value="1h">1 Hour</SelectOption>
                <SelectOption value="4h">4 Hours</SelectOption>
                <SelectOption value="1d">1 Day</SelectOption>
              </Select>
            </div>

            {renderParameterInputs()}

            <div className="flex space-x-2 pt-4">
              <Button
                type="button"
                onClick={resetNewStrategy}
                variant="outline"
              >
                Reset
              </Button>
              <Button
                type="button"
                onClick={saveStrategy}
                disabled={!newStrategy.id || !newStrategy.name}
              >
                {selectedStrategy ? 'Update Strategy' : 'Save Strategy'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="w-full">
        <div className="p-4 border-b">
          <h3 className="text-lg font-medium">Test & Manage Strategies</h3>
        </div>
        <div className="p-4">
          <div className="mb-6">
            <h4 className="font-medium mb-2">Test Current Strategy</h4>
            <div className="flex space-x-2 mb-4">
              <Button
                type="button"
                onClick={loadMarketData}
                disabled={isLoading}
                variant="outline"
              >
                {isLoading ? 'Loading...' : 'Load Market Data'}
              </Button>
              <Button
                type="button"
                onClick={testStrategy}
                disabled={!marketData.length || isLoading}
              >
                Test Strategy
              </Button>
            </div>

            {testResult && (
              <div className={`p-4 rounded-lg ${testResult.signal === 'BUY'
                  ? 'bg-green-100 text-green-800'
                  : testResult.signal === 'SELL'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-neutral-100 text-neutral-800'
                }`}>
                <div className="font-medium">
                  Signal: {testResult.signal || 'NEUTRAL'}
                </div>
                <div className="text-sm mt-1">
                  {testResult.reason}
                </div>
                <div className="text-sm mt-2">
                  Confidence: {testResult.confidence}%
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-medium mb-2">Saved Strategies</h4>
            <div className="space-y-2">
              {strategies.map(strategy => (
                <div
                  key={strategy.id}
                  className={`p-3 border rounded-md cursor-pointer ${selectedStrategy?.id === strategy.id ? 'border-blue-500 bg-blue-50' : 'border-neutral-200'
                    }`}
                  onClick={() => selectStrategy(strategy)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium">{strategy.name}</div>
                      <div className="text-xs text-neutral-500">{strategy.type}</div>
                    </div>
                    <button
                      className="text-red-500 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteStrategy(strategy.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}

              {strategies.length === 0 && (
                <div className="text-center py-4 text-neutral-500">
                  No saved strategies yet
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default StrategyBuilder;
