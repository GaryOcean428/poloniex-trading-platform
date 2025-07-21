import React, { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Switch } from '@/components/ui/Switch';
import { Slider } from '@/components/ui/Slider';
import { liveAutonomousTradingEngine, LiveAutonomousSession } from '@/services/liveAutonomousTradingEngine';
import { autonomousTradingAPI, BankingConfig, RiskToleranceConfig } from '@/services/autonomousTradingAPI';
import { AutonomousSettings } from '@/services/autonomousTradingEngine';
import {
  Brain,
  CheckCircle,
  Info,
  Play,
  Settings,
  Shield,
  Target,
  TrendingUp,
  X,
  DollarSign,
  Activity,
  AlertTriangle,
  Zap,
  BarChart3,
  PiggyBank,
  Clock,
  Users,
  RefreshCw
} from 'lucide-react';

const LiveAutonomousTradingDashboard: React.FC = () => {
  const [session, setSession] = useState<LiveAutonomousSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showBankingConfig, setShowBankingConfig] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(liveAutonomousTradingEngine.getConnectionStatus());
  
  // Configuration states
  const [settings, setSettings] = useState<AutonomousSettings>({
    initialBalance: 10000,
    maxRiskPerTrade: 0.02,
    maxDrawdown: 0.15,
    confidenceThreshold: 75,
    profitTarget: 0.20,
    timeHorizon: 30,
    aggressiveness: 'moderate',
    autoProgressToLive: true,
    stopLossGlobal: 0.05,
    takeProfitGlobal: 0.10
  });

  const [bankingConfig, setBankingConfig] = useState<BankingConfig>({
    enabled: true,
    bankingPercentage: 0.30,
    minimumProfitThreshold: 50,
    maximumSingleTransfer: 10000,
    bankingInterval: 6 * 60 * 60 * 1000,
    emergencyStopThreshold: 0.25,
    maxDailyBanking: 50000
  });

  const [manualBankingAmount, setManualBankingAmount] = useState<number>(100);

  // Load initial configuration
  useEffect(() => {
    loadConfiguration();
  }, []);

  // Set up real-time updates
  useEffect(() => {
    if (session?.isActive) {
      const interval = setInterval(() => {
        const updatedSession = liveAutonomousTradingEngine.getAutonomousSession(session.id);
        if (updatedSession) {
          setSession(updatedSession);
        }
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [session?.id, session?.isActive]);

  // Set up event listeners
  useEffect(() => {
    const handleConnectionChange = (data: any) => {
      setConnectionStatus(liveAutonomousTradingEngine.getConnectionStatus());
    };

    const handleNotification = (data: any) => {
      if (data.notification.type === 'CRITICAL') {
        setError(data.notification.message);
      }
    };

    const handlePerformanceUpdate = (data: any) => {
      if (session && data.sessionId === session.id) {
        setSession(prev => prev ? { ...prev, performance: data.performance } : null);
      }
    };

    liveAutonomousTradingEngine.on('connectionStateChanged', handleConnectionChange);
    liveAutonomousTradingEngine.on('notificationAdded', handleNotification);
    liveAutonomousTradingEngine.on('performanceUpdate', handlePerformanceUpdate);

    return () => {
      liveAutonomousTradingEngine.off('connectionStateChanged', handleConnectionChange);
      liveAutonomousTradingEngine.off('notificationAdded', handleNotification);
      liveAutonomousTradingEngine.off('performanceUpdate', handlePerformanceUpdate);
    };
  }, [session]);

  // Load configuration from backend
  const loadConfiguration = async () => {
    try {
      if (connectionStatus.useBackend) {
        const config = await autonomousTradingAPI.getConfig();
        setBankingConfig(config.bankingConfig);
        
        // Convert risk tolerance to settings
        setSettings(prev => ({
          ...prev,
          maxRiskPerTrade: config.riskTolerance.riskPerTrade,
          maxDrawdown: config.riskTolerance.maxDrawdown
        }));
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
    }
  };

  // Start autonomous trading
  const handleStart = async () => {
    setLoading(true);
    setError(null);

    try {
      const sessionId = await liveAutonomousTradingEngine.startAutonomousTrading('user_123', settings);
      const newSession = liveAutonomousTradingEngine.getAutonomousSession(sessionId);
      setSession(newSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start autonomous trading');
    } finally {
      setLoading(false);
    }
  };

  // Stop autonomous trading
  const handleStop = async () => {
    if (!session) return;

    setLoading(true);
    try {
      await liveAutonomousTradingEngine.stopAutonomousTrading(session.id);
      const updatedSession = liveAutonomousTradingEngine.getAutonomousSession(session.id);
      setSession(updatedSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop autonomous trading');
    } finally {
      setLoading(false);
    }
  };

  // Emergency stop
  const handleEmergencyStop = async () => {
    if (!session) return;

    setLoading(true);
    try {
      await liveAutonomousTradingEngine.emergencyStop(session.id, 'Manual emergency stop');
      const updatedSession = liveAutonomousTradingEngine.getAutonomousSession(session.id);
      setSession(updatedSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute emergency stop');
    } finally {
      setLoading(false);
    }
  };

  // Update risk tolerance
  const handleUpdateRiskTolerance = async () => {
    if (!session) return;

    try {
      const riskTolerance: RiskToleranceConfig = {
        maxDrawdown: settings.maxDrawdown,
        riskPerTrade: settings.maxRiskPerTrade,
        maxPositionSize: 0.1,
        profitBankingPercent: bankingConfig.bankingPercentage
      };

      await liveAutonomousTradingEngine.updateRiskTolerance(session.id, riskTolerance);
      setShowSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update risk tolerance');
    }
  };

  // Update banking configuration
  const handleUpdateBankingConfig = async () => {
    if (!session) return;

    try {
      await liveAutonomousTradingEngine.updateBankingConfig(session.id, bankingConfig);
      setShowBankingConfig(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update banking configuration');
    }
  };

  // Execute manual banking
  const handleManualBanking = async () => {
    if (!session) return;

    try {
      await liveAutonomousTradingEngine.executeBanking(session.id, manualBankingAmount);
      setManualBankingAmount(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute banking');
    }
  };

  // Get phase icon
  const getPhaseIcon = (phase: string) => {
    switch (phase) {
      case 'INITIALIZATION': return <Settings className="h-5 w-5" />;
      case 'STRATEGY_GENERATION': return <Brain className="h-5 w-5" />;
      case 'BACKTESTING': return <TrendingUp className="h-5 w-5" />;
      case 'STRATEGY_OPTIMIZATION': return <Target className="h-5 w-5" />;
      case 'MOCK_TRADING': return <Activity className="h-5 w-5" />;
      case 'CONFIDENCE_EVALUATION': return <Shield className="h-5 w-5" />;
      case 'READY_FOR_LIVE': return <CheckCircle className="h-5 w-5" />;
      case 'LIVE_TRADING': return <Zap className="h-5 w-5 text-green-500" />;
      case 'LEARNING_ADAPTATION': return <RefreshCw className="h-5 w-5" />;
      case 'PROFIT_MAXIMIZATION': return <PiggyBank className="h-5 w-5" />;
      default: return <Info className="h-5 w-5" />;
    }
  };

  // Get phase color
  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'LIVE_TRADING': return 'bg-green-500';
      case 'PROFIT_MAXIMIZATION': return 'bg-blue-500';
      case 'READY_FOR_LIVE': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  // Get connection status badge
  const getConnectionBadge = () => {
    if (!connectionStatus.useBackend) {
      return <Badge variant="warning" className="bg-yellow-50">Mock Mode</Badge>;
    }
    if (connectionStatus.isConnected) {
      return <Badge variant="default" className="bg-green-50 text-green-700">Live Connected</Badge>;
    }
    return <Badge variant="error">Disconnected</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Live Autonomous Trading</h1>
          <p className="text-gray-600 mt-1">
            AI-powered autonomous trading system with real-time strategy generation and profit banking
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getConnectionBadge()}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConnectionStatus(liveAutonomousTradingEngine.getConnectionStatus())}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="error">
          <AlertTriangle className="h-4 w-4" />
          <div className="flex-1">{error}</div>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Control Panel */}
        <Card className="lg:col-span-1">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">System Control</h2>
            
            {!session?.isActive ? (
              <div className="space-y-4">
                <Button
                  onClick={handleStart}
                  disabled={loading}
                  className="w-full"
                  size="lg"
                >
                  <Play className="h-5 w-5 mr-2" />
                  {loading ? 'Starting...' : 'Start Autonomous Trading'}
                </Button>
                
                <Button
                  variant="outline"
                  onClick={() => setShowSettings(true)}
                  className="w-full"
                >
                  <Settings className="h-5 w-5 mr-2" />
                  Configure Settings
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  {getPhaseIcon(session.currentPhase)}
                  <div className="flex-1 ml-3">
                    <div className="font-medium text-green-900">
                      {session.currentPhase.replace('_', ' ')}
                    </div>
                    <div className="text-sm text-green-600">
                      {session.realTimeUpdates ? 'Live Updates' : 'Polling Updates'}
                    </div>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${getPhaseColor(session.currentPhase)}`} />
                </div>

                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={handleStop}
                    disabled={loading}
                    className="w-full"
                  >
                    <X className="h-5 w-5 mr-2" />
                    Stop Trading
                  </Button>
                  
                  <Button
                    variant="danger"
                    onClick={handleEmergencyStop}
                    disabled={loading}
                    className="w-full"
                  >
                    <AlertTriangle className="h-5 w-5 mr-2" />
                    Emergency Stop
                  </Button>
                </div>

                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSettings(true)}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Settings
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowBankingConfig(true)}
                  >
                    <PiggyBank className="h-4 w-4 mr-1" />
                    Banking
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Performance Dashboard */}
        <Card className="lg:col-span-2">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Performance Overview</h2>
            
            {session ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    ${session.performance.totalPnL.toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-600">Total P&L</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {(session.performance.winRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Win Rate</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {session.performance.sharpeRatio.toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-600">Sharpe Ratio</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {(session.performance.maxDrawdown * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Max Drawdown</div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <BarChart3 className="h-12 w-12 mx-auto mb-2" />
                <p>Start autonomous trading to see performance metrics</p>
              </div>
            )}

            {/* System Status */}
            {session?.backendSystemStatus && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-900">
                    {session.backendSystemStatus.generationCount}
                  </div>
                  <div className="text-sm text-gray-600">Generations</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-900">
                    {session.backendSystemStatus.totalStrategies}
                  </div>
                  <div className="text-sm text-gray-600">Total Strategies</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600">
                    {session.backendSystemStatus.activeStrategies}
                  </div>
                  <div className="text-sm text-gray-600">Active Strategies</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-600">
                    ${session.bankingStatus?.totalBanked.toFixed(2) || '0.00'}
                  </div>
                  <div className="text-sm text-gray-600">Total Banked</div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Detailed Information */}
      {session && (
        <Tabs defaultValue="strategies" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="strategies">Strategies</TabsTrigger>
            <TabsTrigger value="banking">Banking</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
          
          <TabsContent value="strategies" className="space-y-4">
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4">Live Strategies</h3>
                {session.liveStrategies.length > 0 ? (
                  <div className="space-y-3">
                    {session.liveStrategies.map((strategy) => (
                      <div
                        key={strategy.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{strategy.name}</div>
                          <div className="text-sm text-gray-600">
                            {strategy.symbol} • {strategy.type} • {strategy.timeframe}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-green-600">
                            {strategy.performance.profit > 0 ? '+' : ''}
                            {(strategy.performance.profit * 100).toFixed(2)}%
                          </div>
                          <div className="text-sm text-gray-600">
                            {strategy.performance.confidence}% confidence
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-2" />
                    <p>No live strategies active</p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="banking" className="space-y-4">
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4">Profit Banking</h3>
                
                {session.bankingStatus && (
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        ${session.bankingStatus.totalBanked.toFixed(2)}
                      </div>
                      <div className="text-sm text-gray-600">Total Banked</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {session.bankingStatus.totalTransfers}
                      </div>
                      <div className="text-sm text-gray-600">Transfers</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-gray-900">
                        {session.bankingStatus.lastBankingTime
                          ? new Date(session.bankingStatus.lastBankingTime).toLocaleString()
                          : 'Never'
                        }
                      </div>
                      <div className="text-sm text-gray-600">Last Banking</div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <Label htmlFor="bankingAmount">Manual Banking Amount (USDT)</Label>
                      <Input
                        id="bankingAmount"
                        type="number"
                        value={manualBankingAmount}
                        onChange={(e) => setManualBankingAmount(Number(e.target.value))}
                        min="1"
                        max="10000"
                      />
                    </div>
                    <Button onClick={handleManualBanking} className="mt-6">
                      <DollarSign className="h-4 w-4 mr-2" />
                      Bank Now
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="notifications" className="space-y-4">
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4">System Notifications</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {session.notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-3 rounded-lg border-l-4 ${
                        notification.type === 'CRITICAL' ? 'border-red-500 bg-red-50' :
                        notification.type === 'WARNING' ? 'border-yellow-500 bg-yellow-50' :
                        notification.type === 'SUCCESS' ? 'border-green-500 bg-green-50' :
                        'border-blue-500 bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{notification.title}</div>
                        <div className="text-sm text-gray-600">
                          <Clock className="h-4 w-4 inline mr-1" />
                          {new Date(notification.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="text-sm mt-1">{notification.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="system" className="space-y-4">
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4">System Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-600">Connection Status</div>
                    <div className="font-medium">
                      {connectionStatus.useBackend ? 
                        (connectionStatus.isConnected ? 'Connected to Backend' : 'Disconnected') :
                        'Mock Mode'
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Session ID</div>
                    <div className="font-medium font-mono text-xs">{session.id}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Started At</div>
                    <div className="font-medium">{new Date(session.startTime).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Current Phase</div>
                    <div className="font-medium">{session.currentPhase.replace('_', ' ')}</div>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl m-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">Risk Tolerance Settings</h2>
                <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <Label>Maximum Risk Per Trade: {(settings.maxRiskPerTrade * 100).toFixed(1)}%</Label>
                  <Slider
                    value={[settings.maxRiskPerTrade * 100]}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, maxRiskPerTrade: value[0] / 100 }))}
                    min={0.5}
                    max={5}
                    step={0.1}
                    className="mt-2"
                  />
                </div>
                
                <div>
                  <Label>Maximum Drawdown: {(settings.maxDrawdown * 100).toFixed(1)}%</Label>
                  <Slider
                    value={[settings.maxDrawdown * 100]}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, maxDrawdown: value[0] / 100 }))}
                    min={5}
                    max={30}
                    step={0.5}
                    className="mt-2"
                  />
                </div>
                
                <div>
                  <Label>Confidence Threshold: {settings.confidenceThreshold}%</Label>
                  <Slider
                    value={[settings.confidenceThreshold]}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, confidenceThreshold: value[0] }))}
                    min={50}
                    max={95}
                    step={1}
                    className="mt-2"
                  />
                </div>
                
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setShowSettings(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdateRiskTolerance}>
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Banking Configuration Modal */}
      {showBankingConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl m-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">Banking Configuration</h2>
                <Button variant="ghost" size="sm" onClick={() => setShowBankingConfig(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Label>Enable Automatic Banking</Label>
                  <Switch
                    checked={bankingConfig.enabled}
                    onCheckedChange={(checked) => setBankingConfig(prev => ({ ...prev, enabled: checked }))}
                  />
                </div>
                
                <div>
                  <Label>Banking Percentage: {(bankingConfig.bankingPercentage * 100).toFixed(1)}%</Label>
                  <Slider
                    value={[bankingConfig.bankingPercentage * 100]}
                    onValueChange={(value) => setBankingConfig(prev => ({ ...prev, bankingPercentage: value[0] / 100 }))}
                    min={10}
                    max={50}
                    step={1}
                    className="mt-2"
                  />
                </div>
                
                <div>
                  <Label htmlFor="minProfit">Minimum Profit Threshold (USDT)</Label>
                  <Input
                    id="minProfit"
                    type="number"
                    value={bankingConfig.minimumProfitThreshold}
                    onChange={(e) => setBankingConfig(prev => ({ ...prev, minimumProfitThreshold: Number(e.target.value) }))}
                    min="10"
                    max="500"
                  />
                </div>
                
                <div>
                  <Label htmlFor="maxTransfer">Maximum Single Transfer (USDT)</Label>
                  <Input
                    id="maxTransfer"
                    type="number"
                    value={bankingConfig.maximumSingleTransfer}
                    onChange={(e) => setBankingConfig(prev => ({ ...prev, maximumSingleTransfer: Number(e.target.value) }))}
                    min="100"
                    max="50000"
                  />
                </div>
                
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setShowBankingConfig(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdateBankingConfig}>
                    Save Configuration
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default LiveAutonomousTradingDashboard;