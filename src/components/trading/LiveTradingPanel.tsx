import { useState, useEffect } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { tradingEngine } from '@/trading/tradingEngine';
import { Card, CardHeader, CardBody, CardFooter, Button, Switch, Label, Alert } from '@/components/ui';

const LiveTradingPanel: React.FC = () => {
  const { 
    isLiveTrading, 
    apiKey, 
    apiSecret, 
    // Removed unused variables
    autoTradingEnabled,
    updateSettings
  } = useSettings();
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Idle');
  const [balance, setBalance] = useState<number | null>(null);
  
  // Initialize trading engine
  useEffect(() => {
    const init = async () => {
      try {
        await tradingEngine.initialize();
        setIsInitialized(true);
        
        // Get initial balance if in paper mode
        if (!isLiveTrading) {
          const paperEngine = tradingEngine.modeManager.getPaperEngine();
          setBalance(paperEngine.getBalance());
        }
      } catch (err) {
        setError('Failed to initialize trading engine');
        console.error(err);
      }
    };
    
    init();
    
    return () => {
      tradingEngine.stopTrading();
    };
  }, [isLiveTrading]);
  
  // Toggle trading mode
  const toggleTradingMode = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const newMode = isLiveTrading ? 'paper' : 'live';
      const result = await tradingEngine.switchMode(newMode);
      
      if (result.success) {
        updateSettings({ isLiveTrading: !isLiveTrading });
        setStatus(result.status);
        
        if (result.balance) {
          setBalance(result.balance);
        }
      } else {
        setError('Failed to switch trading mode');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Toggle auto trading
  const toggleAutoTrading = async () => {
    try {
      if (autoTradingEnabled) {
        await tradingEngine.stopTrading();
      } else {
        await tradingEngine.startTradingLoop();
      }
      
      updateSettings({ autoTradingEnabled: !autoTradingEnabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle auto trading');
    }
  };
  
  // Check if trading is possible
  const canTrade = isInitialized && (isLiveTrading ? Boolean(apiKey && apiSecret) : true);
  
  return (
    <Card className="w-full">
      <CardHeader>
        <h3 className="text-lg font-medium">Trading Controls</h3>
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
              <Label htmlFor="tradingMode">Live Trading</Label>
              <p className="text-xs text-neutral-500">
                {isLiveTrading 
                  ? 'Trading with real funds on Poloniex' 
                  : 'Paper trading with simulated funds'}
              </p>
            </div>
            <Switch
              id="tradingMode"
              checked={isLiveTrading}
              onCheckedChange={toggleTradingMode}
              disabled={isLoading || !isInitialized || (isLiveTrading && !apiKey)}
            />
          </div>
          
          {!isLiveTrading && balance !== null && (
            <div>
              <Label>Paper Trading Balance</Label>
              <p className="text-lg font-medium">${balance.toFixed(2)}</p>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="autoTrading">Automated Trading</Label>
              <p className="text-xs text-neutral-500">
                Automatically execute trades based on market analysis
              </p>
            </div>
            <Switch
              id="autoTrading"
              checked={autoTradingEnabled}
              onCheckedChange={toggleAutoTrading}
              disabled={!canTrade || isLoading}
            />
          </div>
          
          <div>
            <Label>Current Status</Label>
            <p className="text-sm">{status}</p>
            <p className="text-xs text-neutral-500 mt-1">
              {tradingEngine.getCurrentActivity()}
            </p>
          </div>
        </div>
      </CardBody>
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={() => tradingEngine.stopTrading()}
          disabled={!autoTradingEnabled || isLoading}
        >
          Stop Trading
        </Button>
        
        <Button 
          onClick={() => tradingEngine.startTradingLoop()}
          disabled={autoTradingEnabled || !canTrade || isLoading}
        >
          Start Trading
        </Button>
      </CardFooter>
    </Card>
  );
};

export default LiveTradingPanel;
