import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, Square, Activity, Brain, TrendingUp, AlertCircle, Shield, Zap, BarChart3 } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import StrategyGenerationDisplay from './StrategyGenerationDisplay';
import ActiveStrategiesPanel from './ActiveStrategiesPanel';
import BacktestResultsVisualization from './BacktestResultsVisualization';
import StrategyApprovalQueue from './StrategyApprovalQueue';
import LiveTradingActivityFeed from './LiveTradingActivityFeed';
import PerformanceAnalytics from './PerformanceAnalytics';

const API_BASE_URL = getBackendUrl();

interface AgentStatus {
  id: string;
  userId: string;
  status: 'running' | 'stopped' | 'paused';
  startedAt: Date;
  stoppedAt?: Date;
  strategiesGenerated: number;
  backtestsCompleted: number;
  paperTradesExecuted: number;
  liveTradesExecuted: number;
  totalPnl: number;
  config: any;
}

interface AgentActivity {
  id: string;
  session_id: string;
  activity_type: string;
  description: string;
  metadata: any;
  created_at: Date;
}

interface AgentStrategy {
  id: string;
  session_id: string;
  strategy_name: string;
  status: string;
  backtest_score: number;
  paper_trading_score?: number;
  created_at: Date;
}

const AutonomousAgentDashboard: React.FC = () => {
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [strategies, setStrategies] = useState<AgentStrategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperMode, setPaperMode] = useState(true);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'polling'>('polling');
  const [circuitBreaker, setCircuitBreaker] = useState<{
    isTripped: boolean;
    reason?: string;
    consecutiveLosses: number;
    dailyLossPercent: number;
    cooldownRemaining?: number;
  } | null>(null);
  const [config, setConfig] = useState({
    maxDrawdown: 15,
    positionSize: 2,
    maxConcurrentPositions: 3,
    stopLossPercentage: 5,
    tradingStyle: 'day_trading',
    preferredPairs: ['BTC-USDT', 'ETH-USDT'],
    preferredTimeframes: ['15m', '1h', '4h'],
    automationLevel: 'fully_autonomous',
    strategyGenerationInterval: 24,
    backtestPeriodDays: 365,
    paperTradingDurationHours: 48
  });

  const agentStatusRef = useRef(agentStatus?.status);
  agentStatusRef.current = agentStatus?.status;

  // Initial data fetch + WebSocket setup (runs once)
  useEffect(() => {
    fetchAgentStatus();
    fetchActivity();
    fetchStrategies();

    // WebSocket real-time updates
    let socket: { on: (event: string, cb: (data: any) => void) => void; disconnect: () => void } | null = null;
    import('socket.io-client').then(({ io }) => {
      socket = io(API_BASE_URL, { transports: ['websocket', 'polling'] });
      (socket as any).on('connect', () => {
        setConnectionStatus('connected');
      });
      (socket as any).on('disconnect', () => {
        setConnectionStatus('polling');
      });
      socket!.on('agent:activity', (event: { type: string; data?: { sessionId?: string; description?: string }; timestamp: string }) => {
        setActivity(prev => [{
          id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          session_id: event.data?.sessionId || '',
          activity_type: event.type,
          description: event.data?.description || event.type,
          metadata: event.data,
          created_at: new Date(event.timestamp)
        }, ...prev].slice(0, 50));
      });
    }).catch(() => {
      setConnectionStatus('polling');
    });

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  // Polling interval — adjusts based on agent status
  useEffect(() => {
    const isActive = agentStatus?.status === 'running';
    const pollInterval = isActive ? 10000 : 60000;

    const interval = setInterval(() => {
      fetchAgentStatus();
      if (agentStatusRef.current === 'running') {
        fetchActivity();
        fetchStrategies();
        fetchCircuitBreaker();
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [agentStatus?.status]);

  const getAuthHeaders = useCallback(() => {
    const token = getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }, []);

  const fetchAgentStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/status`, {
        headers: getAuthHeaders()
      });
      
      if (response.data.success) {
        setAgentStatus(response.data.status);
      }
      setLastPolled(new Date());
    } catch (_err: unknown) {
      setLastPolled(new Date());
    }
  };

  const fetchActivity = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/activity?limit=20`, {
        headers: getAuthHeaders()
      });
      
      if (response.data.success) {
        setActivity(response.data.activity);
      }
    } catch (_err: unknown) {
      // Silently handle
    }
  };

  const fetchStrategies = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategies`, {
        headers: getAuthHeaders()
      });
      
      if (response.data.success) {
        setStrategies(response.data.strategies);
      }
    } catch (_err: unknown) {
      // Silently handle
    }
  };

  const fetchCircuitBreaker = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/circuit-breaker`, {
        headers: getAuthHeaders()
      });
      if (response.data.success) {
        setCircuitBreaker(response.data.circuitBreaker);
      }
    } catch (_err: unknown) {
      // Silently handle — circuit breaker display is non-critical
    }
  };

  const startAgent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/start`,
        { ...config, paperTrading: paperMode },
        { headers: getAuthHeaders() }
      );
      
      if (response.data.success) {
        setAgentStatus(response.data.session);
        await fetchAgentStatus();
      }
    } catch (err: any) {
      const code = err.response?.data?.code;
      if (code === 'ALREADY_RUNNING') {
        // Agent is already running — just refresh its status
        await fetchAgentStatus();
      } else {
        setError(err.response?.data?.error || 'Failed to start agent');
      }
    } finally {
      setLoading(false);
    }
  };

  const stopAgent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/stop`,
        {},
        { headers: getAuthHeaders() }
      );
      
      if (response.data.success) {
        await fetchAgentStatus();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to stop agent');
    } finally {
      setLoading(false);
    }
  };

  const pauseAgent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/pause`,
        {},
        { headers: getAuthHeaders() }
      );
      
      if (response.data.success) {
        await fetchAgentStatus();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to pause agent');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'running':
        return 'text-green-600';
      case 'paused':
        return 'text-yellow-600';
      case 'stopped':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStrategyStatusColor = (status: string) => {
    switch (status) {
      case 'live':
        return 'bg-green-100 text-green-700';
      case 'paper_trading':
        return 'bg-blue-100 text-blue-700';
      case 'backtested':
        return 'bg-purple-100 text-purple-700';
      case 'generated':
        return 'bg-gray-100 text-gray-700';
      case 'retired':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Gradient Header - Brand Consistent */}
      <div className="bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg p-8 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Brain className="w-8 h-8" />
              Autonomous Trading Agent
            </h1>
            <p className="mt-2 opacity-90">
              AI-powered autonomous trading system using Claude Sonnet 4.5
            </p>
          </div>

          <div className="flex items-center gap-3">
            {agentStatus?.status === 'running' ? (
              <>
                <button
                  onClick={pauseAgent}
                  disabled={loading}
                  className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg flex items-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-50 focus:ring-4 focus:ring-yellow-300 focus:outline-none"
                  aria-label="Pause autonomous trading agent"
                >
                  <Pause className="w-5 h-5" />
                  Pause
                </button>
                <button
                  onClick={stopAgent}
                  disabled={loading}
                  className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-50 focus:ring-4 focus:ring-red-300 focus:outline-none"
                  aria-label="Stop autonomous trading agent"
                >
                  <Square className="w-5 h-5" />
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={startAgent}
                disabled={loading}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-50 focus:ring-4 focus:ring-green-300 focus:outline-none"
                aria-label="Start autonomous trading agent"
              >
                <Play className="w-5 h-5" />
                {loading ? 'Starting...' : 'Start Agent'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Paper / Live Mode Toggle */}
      <div className="bg-white rounded-lg shadow-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {paperMode ? (
            <Shield className="w-6 h-6 text-blue-600" />
          ) : (
            <Zap className="w-6 h-6 text-orange-500" />
          )}
          <div>
            <p className="font-semibold text-gray-900">
              {paperMode ? 'Paper Trading Mode' : 'Live Trading Mode'}
            </p>
            <p className="text-sm text-gray-500">
              {paperMode 
                ? 'Simulated trades with virtual capital — no real money at risk' 
                : 'Real trades will be executed on your Poloniex account'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setPaperMode(prev => !prev)}
          disabled={agentStatus?.status === 'running'}
          className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed ${paperMode ? 'bg-blue-600' : 'bg-orange-500'}`}
          role="switch"
          aria-checked={paperMode}
          aria-label={paperMode ? 'Switch to live trading' : 'Switch to paper trading'}
          title={agentStatus?.status === 'running' ? 'Stop the agent to change trading mode' : undefined}
        >
          <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${paperMode ? 'translate-x-1' : 'translate-x-9'}`} />
          <span className="sr-only">{paperMode ? 'Paper' : 'Live'}</span>
        </button>
      </div>

      {/* Connection & Heartbeat Status Bar */}
      <div className="bg-white rounded-lg shadow p-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' :
              connectionStatus === 'polling' ? 'bg-yellow-500' :
              'bg-red-500'
            }`} />
            <span className="text-gray-600">
              {connectionStatus === 'connected' ? 'Live WebSocket' :
               connectionStatus === 'polling' ? 'Polling' :
               'Disconnected'}
            </span>
          </div>
          {agentStatus?.status === 'running' && agentStatus?.startedAt && (
            <span className="text-gray-500">
              Running since {new Date(agentStatus.startedAt).toLocaleString()}
            </span>
          )}
        </div>
        {lastPolled && (
          <span className="text-gray-400 text-xs">
            Last checked: {lastPolled.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3" role="alert">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-800 font-semibold">Error</h3>
            <p className="text-red-700 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Circuit Breaker Warning */}
      {circuitBreaker?.isTripped && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4 flex items-start gap-3" role="alert">
          <Shield className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-red-800 font-semibold flex items-center gap-2">
              Circuit Breaker Active
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            </h3>
            <p className="text-red-700 text-sm mt-1">{circuitBreaker.reason}</p>
            {circuitBreaker.cooldownRemaining != null && circuitBreaker.cooldownRemaining > 0 && (
              <p className="text-red-600 text-xs mt-2">
                Auto-reset in {Math.ceil(circuitBreaker.cooldownRemaining / 60000)} min
              </p>
            )}
            <div className="flex gap-4 mt-2 text-xs text-red-600">
              <span>Consecutive losses: {circuitBreaker.consecutiveLosses}</span>
              <span>Daily loss: {circuitBreaker.dailyLossPercent.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Risk Protection Summary (when agent is running) */}
      {agentStatus?.status === 'running' && !circuitBreaker?.isTripped && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-3 text-sm">
          <Shield className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div className="flex-1 flex items-center justify-between">
            <span className="text-green-800">
              Risk protection active — circuit breaker, drawdown scaling, trailing stops enabled
            </span>
            {circuitBreaker && (
              <div className="flex gap-3 text-xs text-green-600">
                <span>Consec. losses: {circuitBreaker.consecutiveLosses}/5</span>
                <span>Daily loss: {circuitBreaker.dailyLossPercent.toFixed(2)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Real-Time Strategy Generation Display */}
      <StrategyGenerationDisplay agentStatus={agentStatus?.status} />

      {/* Strategy Approval Queue */}
      <StrategyApprovalQueue agentStatus={agentStatus?.status} />

      {/* Active Strategies with Performance Metrics */}
      <ActiveStrategiesPanel agentStatus={agentStatus?.status} />

      {/* Status Overview - White Cards with Shadows */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div 
          className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow"
          role="status"
          aria-label={`Agent status: ${agentStatus?.status || 'Stopped'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Status</span>
            <Activity className={`w-5 h-5 ${getStatusColor(agentStatus?.status)}`} />
          </div>
          <p className={`text-2xl font-bold ${getStatusColor(agentStatus?.status)} capitalize`}>
            {agentStatus?.status || 'Stopped'}
          </p>
        </div>

        <div 
          className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow"
          role="status"
          aria-label={`Strategies generated: ${agentStatus?.strategiesGenerated || 0}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Strategies Generated</span>
            <Brain className="w-5 h-5 text-cyan-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {agentStatus?.strategiesGenerated || 0}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {strategies.filter(s => s.status === 'live').length} live · {strategies.filter(s => s.status === 'paper_trading').length} paper
          </p>
        </div>

        <div 
          className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow"
          role="status"
          aria-label={`Backtests completed: ${agentStatus?.backtestsCompleted || 0}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Backtests Completed</span>
            <BarChart3 className="w-5 h-5 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {agentStatus?.backtestsCompleted || 0}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {strategies.filter(s => s.status === 'backtested').length} passed
          </p>
        </div>

        <div 
          className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow"
          role="status"
          aria-label={`Paper trades: ${agentStatus?.paperTradesExecuted || 0}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Paper Trades</span>
            <Shield className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {agentStatus?.paperTradesExecuted || 0}
          </p>
        </div>

        <div 
          className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow"
          role="status"
          aria-label={`Total profit and loss: $${(agentStatus?.totalPnl || 0).toFixed(2)}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Total P&L</span>
            <TrendingUp className={`w-5 h-5 ${(agentStatus?.totalPnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`} />
          </div>
          <p className={`text-2xl font-bold ${(agentStatus?.totalPnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${(agentStatus?.totalPnl || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Performance Analytics */}
      <PerformanceAnalytics agentStatus={agentStatus?.status} />

      {/* Backtest Results Visualization */}
      <BacktestResultsVisualization />

      {/* Strategy Pipeline Summary — link to Backtesting for detailed view */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-cyan-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Strategy Pipeline</h2>
              <p className="text-sm text-gray-500">
                {strategies.length > 0
                  ? `${strategies.length} strategies generated — view full pipeline on Backtesting`
                  : 'Start the agent to generate AI-powered trading strategies'}
              </p>
            </div>
          </div>
          <Link
            to="/backtesting"
            className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            View Pipeline
          </Link>
        </div>
        {strategies.length > 0 && (
          <div className="border-t border-gray-200 px-6 py-4">
            <div className="flex gap-6 text-sm">
              {['generated', 'backtested', 'paper_trading', 'live'].map(status => {
                const count = strategies.filter(s => s.status === status).length;
                return (
                  <div key={status} className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStrategyStatusColor(status)}`}>
                      {status.replace('_', ' ')}
                    </span>
                    <span className="text-gray-600 font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Live Trading Activity Feed */}
      <LiveTradingActivityFeed agentStatus={agentStatus?.status} />

      {/* Activity Log - White Card */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-600" />
            Recent Activity
          </h2>
        </div>
        <div 
          className="p-6"
          role="log"
          aria-label="Recent agent activity"
          aria-live="polite"
        >
          {activity.length > 0 ? (
            <div className="space-y-3">
              {activity.map((item) => (
                <div 
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-cyan-500"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{item.description}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No activity yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-700 mt-4 text-center">Processing...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AutonomousAgentDashboard;
