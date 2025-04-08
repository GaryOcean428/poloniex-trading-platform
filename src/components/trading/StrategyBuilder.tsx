import React, { useState, useEffect } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { Strategy, MarketData } from '@/types';
import { executeStrategy } from '@/utils/strategyExecutors';
import { poloniexApi } from '@/services/poloniexAPI';
import { Card, CardHeader, CardBody, CardFooter, Button, Select, Input, Label, Alert } from '@/components/ui';

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
    }
  });
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [testResult, setTestResult] = useState<{ signal: string | null, reason: string, confidence: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Load saved strategies from localStorage
  useEffect(() => {
    const savedStrategies = localStorage.getItem('trading_strategies');
    if (savedStrategies) {
      try {
        setStrategies(JSON.parse(savedStrategies));
      } catch (err) {
        console.error('Failed to parse saved strategies:', err);
      }
    }
  }, []);
  
  // Save strategies to localStorage when they change
  useEffect(() => {
    if (strategies.length > 0) {
      localStorage.setItem('trading_strategies', JSON.stringify(strategies));
    }
  }, [strategies]);
  
  // Load market data for testing
  const loadMarketData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const pair = newStrategy.parameters?.pair || defaultPair;
      const data = await poloniexApi.getMarketData(pair);
      setMarketData(data);
    } catch (err) {
      setError('Failed to load market data');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Test strategy with current market data
  const testStrategy = () => {
    if (!newStrategy.type || !marketData.length) {
      setError('Strategy or market data not available');
      return;
    }
    
    try {
      const result = executeStrategy(newStrategy as Strategy, marketData);
      setTestResult(result);
    } catch (err) {
      setError('Failed to execute strategy');
      console.error(err);
    }
  };
  
  // Save new strategy
  const saveStrategy = () => {
    if (!newStrategy.id || !newStrategy.name || !newStrategy.type) {
      setError('Strategy ID, name, and type are required');
      return;
    }
    
    // Check if ID already exists
    if (strategies.some(s => s.id === newStrategy.id)) {
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
      }
    });
    setSelectedStrategy(null);
  };
  
  // Update strategy parameters based on type
  const updateStrategyType = (type: string) => {
    let parameters = { pair: defaultPair, timeframe };
    
    switch (type) {
      case 'MovingAverageCrossover':
        parameters = { ...parameters, fastPeriod: 9, slowPeriod: 21 };
        break;
      case 'RSI':
        parameters = { ...parameters, period: 14, overbought: 70, oversold: 30 };
        break;
      case 'MACD':
        parameters = { ...parameters, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
        break;
      case 'BollingerBands':
        parameters = { ...parameters, period: 20, stdDev: 2 };
        break;
    }
    
    setNewStrategy({
      ...newStrategy,
      type: type as any,
      parameters
    });
  };
  
  // Render parameter inputs based on strategy type
  const renderParameterInputs = () => {
    const type = newStrategy.type;
    const parameters = newStrategy.parameters || {};
    
    switch (type) {
      case 'MovingAverageCrossover':
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="fastPeriod">Fast Period</Label>
              <Input
                id="fastPeriod"
                type="number"
                value={parameters.fastPeriod || 9}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, fastPeriod: parseInt(e.target.value) }
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
                value={parameters.slowPeriod || 21}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, slowPeriod: parseInt(e.target.value) }
                })}
                min="5"
                max="200"
              />
            </div>
          </>
        );
        
      case 'RSI':
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="period">RSI Period</Label>
              <Input
                id="period"
                type="number"
                value={parameters.period || 14}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, period: parseInt(e.target.value) }
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
                value={parameters.overbought || 70}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, overbought: parseInt(e.target.value) }
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
                value={parameters.oversold || 30}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, oversold: parseInt(e.target.value) }
                })}
                min="10"
                max="50"
              />
            </div>
          </>
        );
        
      case 'MACD':
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="fastPeriod">Fast Period</Label>
              <Input
                id="fastPeriod"
                type="number"
                value={parameters.fastPeriod || 12}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, fastPeriod: parseInt(e.target.value) }
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
                value={parameters.slowPeriod || 26}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, slowPeriod: parseInt(e.target.value) }
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
                value={parameters.signalPeriod || 9}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, signalPeriod: parseInt(e.target.value) }
                })}
                min="2"
                max="50"
              />
            </div>
          </>
        );
        
      case 'BollingerBands':
        return (
          <>
            <div className="mb-4">
              <Label htmlFor="period">Period</Label>
              <Input
                id="period"
                type="number"
                value={parameters.period || 20}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, period: parseInt(e.target.value) }
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
                value={parameters.stdDev || 2}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...parameters, stdDev: parseFloat(e.target.value) }
                })}
                min="0.5"
                max="4"
                step="0.1"
              />
            </div>
          </>
        );
        
      default:
        return null;
    }
  };
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="w-full">
        <CardHeader>
          <h3 className="text-lg font-medium">Strategy Builder</h3>
        </CardHeader>
        <CardBody>
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
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
                onChange={(e) => updateStrategyType(e.target.value)}
              >
                <option value="MovingAverageCrossover">Moving Average Crossover</option>
                <option value="RSI">Relative Strength Index (RSI)</option>
                <option value="MACD">MACD</option>
                <option value="BollingerBands">Bollinger Bands</option>
                <option value="Custom">Custom</option>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="pair">Trading Pair</Label>
              <Input
                id="pair"
                value={newStrategy.parameters?.pair || defaultPair}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...newStrategy.parameters, pair: e.target.value }
                })}
                placeholder="BTC-USDT"
              />
            </div>
            
            <div>
              <Label htmlFor="timeframe">Timeframe</Label>
              <Select
                id="timeframe"
                value={newStrategy.parameters?.timeframe || timeframe}
                onChange={(e) => setNewStrategy({
                  ...newStrategy,
                  parameters: { ...newStrategy.parameters, timeframe: e.target.value }
                })}
              >
                <option value="1m">1 minute</option>
                <option value="5m">5 minutes</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="4h">4 hours</option>
                <option value="1d">1 day</option>
              </Select>
            </div>
            
            {renderParameterInputs()}
          </div>
        </CardBody>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={resetNewStrategy}>
            {selectedStrategy ? 'Cancel' : 'Reset'}
          </Button>
          <Button onClick={saveStrategy} disabled={isLoading}>
            {selectedStrategy ? 'Update Strategy' : 'Save Strategy'}
          </Button>
        </CardFooter>
      </Card>
      
      <Card className="w-full">
        <CardHeader>
          <h3 className="text-lg font-medium">Test & Manage Strategies</h3>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div className="flex space-x-2">
              <Button onClick={loadMarketData} disabled={isLoading} className="flex-1">
                Load Market Data
              </Button>
              <Button onClick={testStrategy} disabled={isLoading || !marketData.length} className="flex-1">
                Test Strategy
              </Button>
            </div>
            
            {testResult && (
              <div className="p-4 border rounded-md">
                <h4 className="font-medium mb-2">Test Result:</h4>
                <p><strong>Signal:</strong> {testResult.signal || 'No signal'}</p>
                <p><strong>Reason:</strong> {testResult.reason}</p>
                <p><strong>Confidence:</strong> {(testResult.confidence * 100).toFixed(2)}%</p>
              </div>
            )}
            
            <div className="mt-6">
              <h4 className="font-medium mb-2">Saved Strategies</h4>
              {strategies.length === 0 ? (
                <p className="text-gray-500">No strategies saved yet</p>
              ) : (
                <div className="space-y-2">
                  {strategies.map(strategy => (
                    <div key={strategy.id} className="p-3 border rounded-md flex justify-between items-center">
                      <div>
                        <p className="font-medium">{strategy.name}</p>
                        <p className="text-sm text-gray-500">{strategy.type} - {strategy.parameters.pair}</p>
                      </div>
                      <div className="flex space-x-2">
                        <Button size="sm" variant="outline" onClick={() => selectStrategy(strategy)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => deleteStrategy(strategy.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

export default StrategyBuilder;
