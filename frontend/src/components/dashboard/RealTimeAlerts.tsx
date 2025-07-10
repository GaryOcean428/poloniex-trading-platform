import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../../services/websocketService';
import { useTradingContext } from '../../hooks/useTradingContext';
import { 
  Bell, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Info,
  X,
  Volume2,
  VolumeX,
  Settings
} from 'lucide-react';

export interface RealTimeAlert {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  category: 'trade' | 'market' | 'strategy' | 'system' | 'risk';
  title: string;
  message: string;
  timestamp: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  acknowledged: boolean;
  data?: any; // Additional data for the alert
}

interface AlertRules {
  priceChange: {
    enabled: boolean;
    threshold: number; // percentage
  };
  volumeSpike: {
    enabled: boolean;
    threshold: number; // multiplier
  };
  portfolioChange: {
    enabled: boolean;
    threshold: number; // percentage
  };
  strategyStop: {
    enabled: boolean;
  };
  connectionIssues: {
    enabled: boolean;
  };
}

interface RealTimeAlertsProps {
  maxAlerts?: number;
  soundEnabled?: boolean;
  onAlertClick?: (alert: RealTimeAlert) => void;
}

const RealTimeAlerts: React.FC<RealTimeAlertsProps> = ({
  maxAlerts = 50,
  soundEnabled: initialSoundEnabled = true,
  onAlertClick
}) => {
  const { isConnected, on, off } = useWebSocket();
  const { strategies, activeStrategies } = useTradingContext();

  const [alerts, setAlerts] = useState<RealTimeAlert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(initialSoundEnabled);
  const [showSettings, setShowSettings] = useState(false);
  const [alertRules, setAlertRules] = useState<AlertRules>({
    priceChange: { enabled: true, threshold: 5 },
    volumeSpike: { enabled: true, threshold: 3 },
    portfolioChange: { enabled: true, threshold: 2 },
    strategyStop: { enabled: true },
    connectionIssues: { enabled: true }
  });

  // Create alert utility function
  const createAlert = useCallback((
    type: RealTimeAlert['type'],
    category: RealTimeAlert['category'],
    title: string,
    message: string,
    priority: RealTimeAlert['priority'] = 'medium',
    data?: any
  ): RealTimeAlert => {
    return {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      category,
      title,
      message,
      timestamp: Date.now(),
      priority,
      acknowledged: false,
      data
    };
  }, []);

  // Add alert function
  const addAlert = useCallback((alert: RealTimeAlert) => {
    setAlerts(prev => {
      const newAlerts = [alert, ...prev];
      
      // Limit alerts to maxAlerts
      if (newAlerts.length > maxAlerts) {
        return newAlerts.slice(0, maxAlerts);
      }
      
      return newAlerts;
    });

    // Play sound for high/critical priority alerts
    if (soundEnabled && (alert.priority === 'high' || alert.priority === 'critical')) {
      playAlertSound(alert.type);
    }
  }, [maxAlerts, soundEnabled]);

  // Play alert sound
  const playAlertSound = (type: RealTimeAlert['type']) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Different frequencies for different alert types
      const frequencies = {
        success: 800,
        info: 600,
        warning: 400,
        error: 200
      };

      oscillator.frequency.value = frequencies[type];
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('Could not play alert sound:', error);
    }
  };

  // Handle market data alerts
  const handleMarketData = useCallback((marketData: any) => {
    if (!alertRules.priceChange.enabled) return;

    const changePercent = Math.abs(marketData.changePercent || 0);
    
    if (changePercent >= alertRules.priceChange.threshold) {
      const alert = createAlert(
        changePercent >= 10 ? 'error' : 'warning',
        'market',
        'Significant Price Movement',
        `${marketData.pair} moved ${marketData.changePercent > 0 ? '+' : ''}${marketData.changePercent.toFixed(2)}%`,
        changePercent >= 10 ? 'high' : 'medium',
        marketData
      );
      addAlert(alert);
    }
  }, [alertRules.priceChange, createAlert, addAlert]);

  // Handle trade execution alerts
  const handleTradeExecuted = useCallback((tradeData: any) => {
    const isProfit = (tradeData.profit || 0) > 0;
    const alert = createAlert(
      isProfit ? 'success' : 'error',
      'trade',
      'Trade Executed',
      `${tradeData.side?.toUpperCase() || 'TRADE'} ${tradeData.amount || 0} ${tradeData.pair || ''} ${isProfit ? `+$${tradeData.profit?.toFixed(2) || '0.00'}` : `$${tradeData.profit?.toFixed(2) || '0.00'}`}`,
      isProfit ? 'low' : 'medium',
      tradeData
    );
    addAlert(alert);
  }, [createAlert, addAlert]);

  // Handle WebSocket connection changes
  const handleConnectionChange = useCallback((connectionState: string) => {
    if (!alertRules.connectionIssues.enabled) return;

    if (connectionState === 'disconnected' || connectionState === 'failed') {
      const alert = createAlert(
        'error',
        'system',
        'Connection Lost',
        'WebSocket connection lost. Trading may be affected.',
        'high'
      );
      addAlert(alert);
    } else if (connectionState === 'connected') {
      const alert = createAlert(
        'success',
        'system',
        'Connected',
        'WebSocket connection restored.',
        'low'
      );
      addAlert(alert);
    }
  }, [alertRules.connectionIssues, createAlert, addAlert]);

  // Set up WebSocket listeners
  useEffect(() => {
    if (isConnected) {
      on('marketData', handleMarketData);
      on('tradeExecuted', handleTradeExecuted);
      on('connectionStateChanged', handleConnectionChange);

      return () => {
        off('marketData', handleMarketData);
        off('tradeExecuted', handleTradeExecuted);
        off('connectionStateChanged', handleConnectionChange);
      };
    }
  }, [isConnected, handleMarketData, handleTradeExecuted, handleConnectionChange, on, off]);

  // Monitor strategy changes
  useEffect(() => {
    if (!alertRules.strategyStop.enabled) return;

    const previousActiveCount = alerts.filter(a => a.category === 'strategy').length;
    const currentActiveCount = activeStrategies.length;

    if (previousActiveCount > currentActiveCount) {
      const alert = createAlert(
        'warning',
        'strategy',
        'Strategy Stopped',
        `A trading strategy has stopped. ${currentActiveCount} strategies still active.`,
        'medium'
      );
      addAlert(alert);
    }
  }, [activeStrategies.length, alertRules.strategyStop, createAlert, addAlert, alerts]);

  // Acknowledge alert
  const acknowledgeAlert = (alertId: string) => {
    setAlerts(prev => 
      prev.map(alert => 
        alert.id === alertId ? { ...alert, acknowledged: true } : alert
      )
    );
  };

  // Remove alert
  const removeAlert = (alertId: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId));
  };

  // Clear all alerts
  const clearAllAlerts = () => {
    setAlerts([]);
  };

  // Acknowledge all alerts
  const acknowledgeAllAlerts = () => {
    setAlerts(prev => prev.map(alert => ({ ...alert, acknowledged: true })));
  };

  // Get alert icon
  const getAlertIcon = (alert: RealTimeAlert) => {
    switch (alert.type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'info':
      default:
        return <Info className="h-5 w-5 text-blue-500" />;
    }
  };

  // Get alert background color
  const getAlertBgColor = (alert: RealTimeAlert) => {
    const base = alert.acknowledged ? 'opacity-50 ' : '';
    switch (alert.type) {
      case 'success':
        return base + 'bg-green-50 border-green-200';
      case 'warning':
        return base + 'bg-yellow-50 border-yellow-200';
      case 'error':
        return base + 'bg-red-50 border-red-200';
      case 'info':
      default:
        return base + 'bg-blue-50 border-blue-200';
    }
  };

  // Get priority badge color
  const getPriorityColor = (priority: RealTimeAlert['priority']) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Bell className="h-5 w-5 text-neutral-600" />
          <h3 className="text-lg font-medium text-neutral-800">Real-time Alerts</h3>
          {unacknowledgedCount > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              {unacknowledgedCount} new
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Sound Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-md transition-colors ${
              soundEnabled 
                ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' 
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
            }`}
            title={soundEnabled ? 'Disable sound' : 'Enable sound'}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            title="Alert settings"
          >
            <Settings className="h-4 w-4" />
          </button>

          {/* Acknowledge All */}
          {unacknowledgedCount > 0 && (
            <button
              onClick={acknowledgeAllAlerts}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-600 rounded-md hover:bg-blue-200 transition-colors"
            >
              Acknowledge All
            </button>
          )}

          {/* Clear All */}
          {alerts.length > 0 && (
            <button
              onClick={clearAllAlerts}
              className="px-3 py-1 text-sm bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 bg-neutral-50 rounded-md border">
          <h4 className="text-md font-medium mb-3">Alert Settings</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={alertRules.priceChange.enabled}
                  onChange={(e) => setAlertRules(prev => ({
                    ...prev,
                    priceChange: { ...prev.priceChange, enabled: e.target.checked }
                  }))}
                  className="rounded"
                />
                <span className="text-sm">Price change alerts</span>
              </label>
              {alertRules.priceChange.enabled && (
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={alertRules.priceChange.threshold}
                  onChange={(e) => setAlertRules(prev => ({
                    ...prev,
                    priceChange: { ...prev.priceChange, threshold: parseFloat(e.target.value) }
                  }))}
                  className="mt-1 block w-full px-3 py-1 border border-gray-300 rounded-md text-sm"
                  placeholder="Threshold %"
                />
              )}
            </div>

            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={alertRules.portfolioChange.enabled}
                  onChange={(e) => setAlertRules(prev => ({
                    ...prev,
                    portfolioChange: { ...prev.portfolioChange, enabled: e.target.checked }
                  }))}
                  className="rounded"
                />
                <span className="text-sm">Portfolio change alerts</span>
              </label>
            </div>

            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={alertRules.strategyStop.enabled}
                  onChange={(e) => setAlertRules(prev => ({
                    ...prev,
                    strategyStop: { ...prev.strategyStop, enabled: e.target.checked }
                  }))}
                  className="rounded"
                />
                <span className="text-sm">Strategy alerts</span>
              </label>
            </div>

            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={alertRules.connectionIssues.enabled}
                  onChange={(e) => setAlertRules(prev => ({
                    ...prev,
                    connectionIssues: { ...prev.connectionIssues, enabled: e.target.checked }
                  }))}
                  className="rounded"
                />
                <span className="text-sm">Connection alerts</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Alerts List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {alerts.length > 0 ? (
          alerts.map(alert => (
            <div
              key={alert.id}
              className={`p-3 rounded-md border transition-all duration-200 cursor-pointer ${getAlertBgColor(alert)}`}
              onClick={() => {
                if (onAlertClick) {
                  onAlertClick(alert);
                }
                if (!alert.acknowledged) {
                  acknowledgeAlert(alert.id);
                }
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3 flex-1">
                  {getAlertIcon(alert)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <h4 className="text-sm font-medium text-neutral-800 truncate">
                        {alert.title}
                      </h4>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(alert.priority)}`}>
                        {alert.priority}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-600 mt-1">
                      {alert.message}
                    </p>
                    <p className="text-xs text-neutral-400 mt-1">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAlert(alert.id);
                  }}
                  className="ml-2 p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8">
            <Bell className="h-12 w-12 text-neutral-300 mx-auto mb-4" />
            <p className="text-neutral-500">No alerts yet</p>
            <p className="text-sm text-neutral-400 mt-1">
              Real-time alerts will appear here
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RealTimeAlerts;