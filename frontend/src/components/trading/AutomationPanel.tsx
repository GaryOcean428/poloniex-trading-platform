import { useState, useEffect } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { tradingEngine } from '@/trading/tradingEngine';
import { executeStrategy } from '@/utils/strategyExecutors';
import { poloniexApi } from '@/services/poloniexAPI';
import { logger } from '@/utils/logger';
import { Card, CardHeader, CardBody, CardFooter, Button, Switch, Label, Alert } from '@/components/ui';

const AutomationPanel: React.FC = () => {
  const { 
    autoTradingEnabled, 
    defaultPair,
    // Removed unused timeframe variable
    leverage,
    riskPerTrade,
    stopLossPercent,
    takeProfitPercent,
    updateSettings
  } = useSettings();
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [activeStrategy, setActiveStrategy] = useState<string | null>(null);
  const [lastSignal, setLastSignal] = useState<{
    time: string;
    pair: string;
    signal: string | null;
    reason: string;
  } | null>(null);
  
  // Load saved strategies
  useEffect(() => {
    const savedStrategies = localStorage.getItem('trading_strategies');
    if (savedStrategies) {
      try {
        setStrategies(JSON.parse(savedStrategies));
      } catch (err) {
        console.error('Failed to parse saved strategies:', err);
      }
    }
    
    // Load active strategy
    const active = localStorage.getItem('active_strategy');
    if (active) {
      setActiveStrategy(active);
    }
  }, []);
  
  // Start/stop automation
  const toggleAutomation = async () => {
    try {
      if (autoTradingEnabled) {
        await tradingEngine.stopTrading();
        updateSettings({ autoTradingEnabled: false });
      } else {
        if (!activeStrategy) {
          setError('Please select a strategy to activate automation');
          return;
        }
        
        await tradingEngine.startTradingLoop();
        updateSettings({ autoTradingEnabled: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle automation');
    }
  };
  
  // Activate a strategy
  const activateStrategy = (strategyId: string) => {
    setActiveStrategy(strategyId);
    localStorage.setItem('active_strategy', strategyId);
  };
  
  // Run strategy once
  const runStrategyOnce = async (strategyId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const strategy = strategies.find(s => s.id === strategyId);
      if (!strategy) {
        throw new Error('Strategy not found');
      }
      
      // Get market data
      const pair = strategy.parameters.pair || defaultPair;
      const data = await poloniexApi.getMarketData(pair);
      
      // Execute strategy
      const result = executeStrategy(strategy, data);
      
      // Record signal
      setLastSignal({
        time: new Date().toLocaleTimeString(),
        pair,
        signal: result.signal,
        reason: result.reason
      });
      
      // Execute trade if signal is present and confidence is high enough
      if (result.signal && result.confidence > 0.7) {
        const side = result.signal === 'BUY' ? 'buy' : 'sell';
        
        // Check if we're in paper or live mode
        if (tradingEngine.modeManager.isLiveMode()) {
          // For live trading, use the API - fixed parameter count
          await poloniexApi.placeOrder(
            pair,
            side,
            'market',
            0.001 // Minimum order size
          );
        } else {
          // For paper trading, use the paper engine
          const paperEngine = tradingEngine.modeManager.getPaperEngine();
          await paperEngine.placeOrder({
            symbol: pair,
            side: side.toLowerCase() as 'buy' | 'sell',
            type: 'market',
            size: 0.001,
            leverage
          });
        }
        
        logger.info(`Executed ${side} order based on strategy ${strategy.name}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run strategy');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Card className="w-full">
      <CardHeader>
        <h3 className="text-lg font-medium">Trading Automation</h3>
      </CardHeader>
      <CardBody>
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="automation">Automated Trading</Label>
              <p className="text-xs text-neutral-500">
                Automatically execute trades based on your active strategy
              </p>
            </div>
            <Switch
              id="automation"
              checked={autoTradingEnabled}
              onCheckedChange={toggleAutomation}
              disabled={isLoading || !activeStrategy}
            />
          </div>
          
          {lastSignal && (
            <div className="p-4 border rounded-md">
              <h4 className="font-medium mb-2">Last Signal:</h4>
              <p><strong>Time:</strong> {lastSignal.time}</p>
              <p><strong>Pair:</strong> {lastSignal.pair}</p>
              <p><strong>Signal:</strong> {lastSignal.signal || 'No signal'}</p>
              <p><strong>Reason:</strong> {lastSignal.reason}</p>
            </div>
          )}
          
          <div className="mt-6">
            <h4 className="font-medium mb-2">Available Strategies</h4>
            {strategies.length === 0 ? (
              <p className="text-neutral-500">No strategies available. Create one in the Strategy Builder.</p>
            ) : (
              <div className="space-y-2">
                {strategies.map(strategy => (
                  <div 
                    key={strategy.id} 
                    className={`p-3 border rounded-md flex justify-between items-center ${
                      activeStrategy === strategy.id ? 'border-blue-500 bg-blue-50' : ''
                    }`}
                  >
                    <div>
                      <p className="font-medium">{strategy.name}</p>
                      <p className="text-sm text-neutral-500">{strategy.type} - {strategy.parameters.pair}</p>
                    </div>
                    <div className="flex space-x-2">
                      <Button 
                        size="sm" 
                        variant={activeStrategy === strategy.id ? "default" : "outline"}
                        onClick={() => activateStrategy(strategy.id)}
                      >
                        {activeStrategy === strategy.id ? 'Active' : 'Activate'}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => runStrategyOnce(strategy.id)}
                        disabled={isLoading}
                      >
                        Run Once
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardBody>
      <CardFooter>
        <p className="text-sm text-neutral-500">
          Trading parameters: {leverage}x leverage, {riskPerTrade}% risk per trade, 
          {stopLossPercent}% stop loss, {takeProfitPercent}% take profit
        </p>
      </CardFooter>
    </Card>
  );
};

export default AutomationPanel;
