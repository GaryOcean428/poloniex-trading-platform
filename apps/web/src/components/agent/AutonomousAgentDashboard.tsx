import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, Square, Activity, Brain, TrendingUp, AlertCircle, Shield, BarChart3, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import StrategyGenerationDisplay from './StrategyGenerationDisplay';
import ActiveStrategiesPanel from './ActiveStrategiesPanel';
import BacktestResultsVisualization from './BacktestResultsVisualization';
import StrategyApprovalQueue from './StrategyApprovalQueue';
import LiveTradingActivityFeed from './LiveTradingActivityFeed';
import PerformanceAnalytics from './PerformanceAnalytics';
import AgentOverviewPanel from './AgentOverviewPanel';

const API_BASE_URL = getBackendUrl();

const RISK_CONFIGS = {
  conservative: { maxDrawdown: 8, positionSize: 1, stopLossPercentage: 3, maxConcurrentPositions: 2 },
  balanced: { maxDrawdown: 15, positionSize: 2, stopLossPercentage: 5, maxConcurrentPositions: 3 },
  aggressive: { maxDrawdown: 25, positionSize: 5, stopLossPercentage: 8, maxConcurrentPositions: 5 }
} as const;

const FALLBACK_HEALTH_STATUS = {
  healthy: false,
  dependencies: {
    database: { healthy: false, message: 'Unreachable' },
    agentService: { healthy: false, message: 'Unreachable' }
  },
  timestamp: ''
};

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
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'polling'>('polling');
  const [circuitBreaker, setCircuitBreaker] = useState<{
    isTripped: boolean;
    reason?: string;
    consecutiveLosses: number;
    dailyLossPercent: number;
    cooldownRemaining?: number;
  } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [existingSession, setExistingSession] = useState<{
    sessionId: string | null;
    state: string;
    startedAt: string | null;
    resumeAllowed: boolean;
  } | null>(null);
  const [healthStatus, setHealthStatus] = useState<{
    healthy: boolean;
    dependencies: Record<string, { healthy: boolean; message: string }>;
    timestamp: string;
  } | null>(null);
  const [riskAppetite, setRiskAppetite] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [executionMode, setExecutionMode] = useState<'backtest' | 'paper' | 'live'>('paper');
  const [performanceMode, setPerformanceMode] = useState<'all' | 'backtest' | 'paper' | 'live'>('all');
  const [agentEvents, setAgentEvents] = useState<Array<{
    id: string;
    event_type: string;
    execution_mode: string;
    description: string;
    explanation: string;
    confidence_score: number;
    created_at: string;
  }>>([]);
  const [capabilitySummary, setCapabilitySummary] = useState<{
    totalStrategies: number;
    tier1: number;
    tier2: number;
    tier3: number;
    averageCompositeScore: number;
  } | null>(null);
  const [eventFilter, setEventFilter] = useState<'all' | 'trade_decision' | 'state_change' | 'risk_action' | 'health_alert' | 'error'>('all');
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
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
    fetchHealth();
    fetchCapabilities();

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
        fetchHealth();
        fetchEvents();
      }
      fetchCapabilities();
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

  const fetchHealth = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/health`, {
        headers: getAuthHeaders()
      });
      if (response.data.success) {
        setHealthStatus(response.data);
        setLastHeartbeat(new Date());
      }
    } catch {
      setHealthStatus({
        ...FALLBACK_HEALTH_STATUS,
        timestamp: new Date().toISOString()
      });
    }
  };

  const fetchEvents = async () => {
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (eventFilter !== 'all') params.set('type', eventFilter);
      const response = await axios.get(`${API_BASE_URL}/api/agent/events?${params.toString()}`, {
        headers: getAuthHeaders()
      });
      if (response.data.success) {
        setAgentEvents(response.data.events);
      }
    } catch {
      // Events are non-critical
    }
  };

  const fetchCapabilities = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/capabilities`, {
        headers: getAuthHeaders()
      });
      if (response.data.success) {
        setCapabilitySummary(response.data.capabilitySummary);
      }
    } catch {
      setCapabilitySummary(null);
    }
  };

  const startAgent = async () => {
    setLoading(true);
    setError(null);
    setExistingSession(null);
    
    try {
      const riskConfig = RISK_CONFIGS[riskAppetite];

      const response = await axios.post(
        `${API_BASE_URL}/api/agent/start`,
        { ...config, ...riskConfig, paperTrading: executionMode === 'paper', executionMode },
        { headers: getAuthHeaders() }
      );
      
      if (response.data.success) {
        setAgentStatus(response.data.session);
        await fetchAgentStatus();
      }
    } catch (err: any) {
      const data = err.response?.data;
      const code = data?.code;
      
      if (code === 'ALREADY_RUNNING') {
        setExistingSession({
          sessionId: data.existingSessionId,
          state: data.existingState,
          startedAt: data.startedAt,
          resumeAllowed: data.resumeAllowed
        });
        await fetchAgentStatus();
      } else if (err.response?.status === 503) {
        setError('Service temporarily unavailable. Some dependencies may be down.');
        await fetchHealth();
      } else {
        setError(data?.error || 'Failed to start agent');
      }
    } finally {
      setLoading(false);
    }
  };

  const resumeAgent = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/resume`,
        {},
        { headers: getAuthHeaders() }
      );
      if (response.data.success) {
        setExistingSession(null);
        await fetchAgentStatus();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to resume agent');
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

      {/* Existing Session Banner */}
      {existingSession && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3" role="alert">
          <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-amber-800 font-semibold">Agent Session Already Active</h3>
            <p className="text-amber-700 text-sm mt-1">
              An agent session is currently {existingSession.state}.
              {existingSession.startedAt && (
                <> Started <time dateTime={existingSession.startedAt}>{new Date(existingSession.startedAt).toLocaleString()}</time></>
              )}
            </p>
            <div className="flex gap-3 mt-3">
              {existingSession.resumeAllowed && (
                <button onClick={resumeAgent} disabled={loading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  Resume Session
                </button>
              )}
              <button onClick={() => { fetchAgentStatus(); setExistingSession(null); }} 
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                View Current Session
              </button>
              <button onClick={stopAgent} disabled={loading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Stop Existing Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Health / Degraded State Banner */}
      {healthStatus && !healthStatus.healthy && (
        <div className="bg-orange-50 border border-orange-300 rounded-lg p-4" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-orange-800 font-semibold">Service Degraded</h3>
              <p className="text-orange-700 text-sm mt-1">
                Some services are unavailable. Historical data and read-only features still work.
              </p>
              <div className="mt-2 space-y-1">
                {healthStatus.dependencies && Object.entries(healthStatus.dependencies).map(([key, dep]) => (
                  dep && typeof dep === 'object' && 'healthy' in dep && (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full ${dep.healthy ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className={dep.healthy ? 'text-green-700' : 'text-red-700'}>{dep.message}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Risk Appetite & Execution Mode */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Agent Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Risk Appetite */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Risk Appetite</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'conservative', label: 'Conservative', desc: 'Low risk, steady returns', activeClass: 'border-blue-500 bg-blue-50' },
                { value: 'balanced', label: 'Balanced', desc: 'Moderate risk & reward', activeClass: 'border-cyan-500 bg-cyan-50' },
                { value: 'aggressive', label: 'Aggressive', desc: 'High risk, high reward', activeClass: 'border-orange-500 bg-orange-50' }
              ] as const).map(opt => (
                <button key={opt.value}
                  onClick={() => setRiskAppetite(opt.value)}
                  disabled={agentStatus?.status === 'running'}
                  className={`p-3 rounded-lg border-2 text-left transition-all disabled:opacity-50 ${
                    riskAppetite === opt.value
                      ? opt.activeClass
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className="font-semibold text-sm text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
          {/* Execution Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Execution Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'backtest', label: 'Backtest', desc: 'Historical simulation', icon: '📊', bgClass: 'border-purple-500 bg-purple-50' },
                { value: 'paper', label: 'Paper', desc: 'Simulated capital', icon: '📝', bgClass: 'border-blue-500 bg-blue-50' },
                { value: 'live', label: 'Live', desc: 'Real capital', icon: '⚡', bgClass: 'border-red-500 bg-red-50' }
              ] as const).map(opt => (
                <button key={opt.value}
                  onClick={() => setExecutionMode(opt.value)}
                  disabled={agentStatus?.status === 'running'}
                  className={`p-3 rounded-lg border-2 text-left transition-all disabled:opacity-50 ${
                    executionMode === opt.value ? opt.bgClass : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className="font-semibold text-sm text-gray-900">{opt.icon} {opt.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
                </button>
              ))}
            </div>
            {executionMode === 'live' && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm font-medium">⚠️ Live Trading — Real money will be used</p>
                <p className="text-red-600 text-xs mt-1">Ensure you have reviewed your risk settings and account balance.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Stop — visible when live trading is active */}
      {agentStatus?.status === 'running' && (executionMode === 'live' || agentStatus?.config?.executionMode === 'live') && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-red-600" />
            <div>
              <p className="font-semibold text-red-800">Live Trading Active</p>
              <p className="text-sm text-red-600">Kill switch — immediately stops all live trading</p>
            </div>
          </div>
          <button
            onClick={stopAgent}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors shadow-lg hover:shadow-xl animate-pulse"
          >
            🛑 KILL SWITCH
          </button>
        </div>
      )}

      {/* Agent Configuration Panel */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          disabled={agentStatus?.status === 'running'}
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-gray-600" />
            <div className="text-left">
              <p className="font-semibold text-gray-900">Agent Configuration</p>
              <p className="text-sm text-gray-500">
                {config.tradingStyle.replace('_', ' ')} · {config.preferredPairs.join(', ')} · Max DD {config.maxDrawdown}%
              </p>
            </div>
          </div>
          {showConfig ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>
        {showConfig && (
          <div className="border-t border-gray-200 p-6 space-y-4">
            {agentStatus?.status === 'running' && (
              <p className="text-sm text-amber-600 bg-amber-50 rounded p-2">⚠ Stop the agent to change configuration.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Trading Style */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trading Style</label>
                <select
                  value={config.tradingStyle}
                  onChange={e => setConfig(c => ({ ...c, tradingStyle: e.target.value }))}
                  disabled={agentStatus?.status === 'running'}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="scalping">Scalping (high frequency, tight stops)</option>
                  <option value="day_trading">Day Trading (intraday, moderate risk)</option>
                  <option value="swing_trading">Swing Trading (multi-day, wider stops)</option>
                </select>
              </div>
              {/* Max Drawdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Drawdown: {config.maxDrawdown}%
                </label>
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={config.maxDrawdown}
                  onChange={e => setConfig(c => ({ ...c, maxDrawdown: parseInt(e.target.value) }))}
                  disabled={agentStatus?.status === 'running'}
                  className="w-full accent-cyan-600"
                />
                <div className="flex justify-between text-xs text-gray-400"><span>5% (safe)</span><span>30% (aggressive)</span></div>
              </div>
              {/* Position Size */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Position Size: {config.positionSize}% of capital
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={config.positionSize}
                  onChange={e => setConfig(c => ({ ...c, positionSize: parseFloat(e.target.value) }))}
                  disabled={agentStatus?.status === 'running'}
                  className="w-full accent-cyan-600"
                />
                <div className="flex justify-between text-xs text-gray-400"><span>1% (conservative)</span><span>10% (aggressive)</span></div>
              </div>
              {/* Stop Loss */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stop Loss: {config.stopLossPercentage}%
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={config.stopLossPercentage}
                  onChange={e => setConfig(c => ({ ...c, stopLossPercentage: parseFloat(e.target.value) }))}
                  disabled={agentStatus?.status === 'running'}
                  className="w-full accent-cyan-600"
                />
              </div>
              {/* Max Concurrent Positions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Concurrent Positions: {config.maxConcurrentPositions}
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={config.maxConcurrentPositions}
                  onChange={e => setConfig(c => ({ ...c, maxConcurrentPositions: parseInt(e.target.value) }))}
                  disabled={agentStatus?.status === 'running'}
                  className="w-full accent-cyan-600"
                />
              </div>
              {/* Automation Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Automation Level</label>
                <select
                  value={config.automationLevel}
                  onChange={e => setConfig(c => ({ ...c, automationLevel: e.target.value }))}
                  disabled={agentStatus?.status === 'running'}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="fully_autonomous">Fully Autonomous (no approval needed)</option>
                  <option value="semi_autonomous">Semi-Autonomous (approve before live)</option>
                  <option value="manual_override">Manual Override (approve all actions)</option>
                </select>
              </div>
            </div>
            {/* Preferred Pairs */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Trading Pairs</label>
              <div className="flex flex-wrap gap-2">
                {['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', 'AVAX-USDT'].map(pair => (
                  <button
                    key={pair}
                    onClick={() => setConfig(c => ({
                      ...c,
                      preferredPairs: c.preferredPairs.includes(pair)
                        ? c.preferredPairs.filter(p => p !== pair)
                        : [...c.preferredPairs, pair]
                    }))}
                    disabled={agentStatus?.status === 'running'}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
                      config.preferredPairs.includes(pair)
                        ? 'bg-cyan-100 text-cyan-700 border border-cyan-300'
                        : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {pair}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
        {lastHeartbeat && (() => {
          const heartbeatAge = Math.round((Date.now() - lastHeartbeat.getTime()) / 1000);
          return (
            <span className="text-gray-400 text-xs flex items-center gap-1" aria-label={`Last heartbeat ${heartbeatAge} seconds ago`}>
              💓 Heartbeat: {heartbeatAge}s ago
            </span>
          );
        })()}
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

      {/* Performance Mode Tabs */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="border-b border-gray-200 px-6 pt-4">
          <div className="flex gap-1">
            {(['all', 'backtest', 'paper', 'live'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setPerformanceMode(mode)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  performanceMode === mode
                    ? mode === 'live' ? 'bg-red-50 text-red-700 border-b-2 border-red-500'
                    : mode === 'paper' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-500'
                    : mode === 'backtest' ? 'bg-purple-50 text-purple-700 border-b-2 border-purple-500'
                    : 'bg-gray-50 text-gray-700 border-b-2 border-gray-500'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {mode === 'all' ? 'All Modes' : mode === 'backtest' ? '📊 Backtest' : mode === 'paper' ? '📝 Paper' : '⚡ Live'}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 text-sm text-gray-500">
          {performanceMode === 'all'
            ? 'Showing combined performance across all execution modes'
            : performanceMode === 'live'
            ? '⚠️ Showing LIVE trading performance — real capital metrics'
            : performanceMode === 'paper'
            ? 'Showing paper trading performance — simulated capital'
            : 'Showing historical backtest performance'}
        </div>
      </div>

      {/* Profitability & Agent Oversight Panel */}
      <AgentOverviewPanel
        agentStatus={agentStatus?.status}
        startedAt={agentStatus?.startedAt}
        circuitBreakerTripped={circuitBreaker?.isTripped}
      />

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

      {/* Agent Activity Timeline */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-600" />
              Agent Activity Timeline
            </h2>
            <div className="flex gap-1">
              {['all', 'trade_decision', 'state_change', 'risk_action', 'health_alert', 'error'].map(filter => (
                <button key={filter}
                  onClick={() => setEventFilter(filter)}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    eventFilter === filter
                      ? 'bg-cyan-100 text-cyan-700 font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}>
                  {filter === 'all' ? 'All' : filter.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="p-6 max-h-96 overflow-y-auto">
          {agentEvents.length > 0 ? (
            <div className="space-y-3">
              {agentEvents.map((event) => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border-l-4 border-l-cyan-400">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        event.event_type === 'trade_decision' ? 'bg-green-100 text-green-700' :
                        event.event_type === 'risk_action' ? 'bg-red-100 text-red-700' :
                        event.event_type === 'state_change' ? 'bg-blue-100 text-blue-700' :
                        event.event_type === 'health_alert' ? 'bg-orange-100 text-orange-700' :
                        event.event_type === 'error' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>{event.event_type?.replace(/_/g, ' ') || 'event'}</span>
                      {event.execution_mode && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          event.execution_mode === 'live' ? 'bg-red-100 text-red-700' :
                          event.execution_mode === 'paper' ? 'bg-blue-100 text-blue-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>{event.execution_mode}</span>
                      )}
                      {event.confidence_score != null && (
                        <span className="text-xs text-gray-500">Confidence: {Number(event.confidence_score).toFixed(1)}%</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900">{event.description}</p>
                    {event.explanation && (
                      <p className="text-xs text-gray-500 mt-1">{event.explanation}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No agent events yet</p>
              <p className="text-gray-400 text-sm mt-1">Events will appear here once the agent starts making decisions</p>
            </div>
          )}
        </div>
      </div>

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

      {capabilitySummary && capabilitySummary.totalStrategies > 0 && (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Capability Tiers</h2>
            <p className="text-sm text-gray-500 mb-4">
              Composite scoring with adaptive improvement hints for autonomous strategy quality.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-gray-500">Strategies</div>
                <div className="text-xl font-semibold text-gray-900">{capabilitySummary.totalStrategies}</div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-lg">
                <div className="text-emerald-700">Tier 1</div>
                <div className="text-xl font-semibold text-emerald-800">{capabilitySummary.tier1}</div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-blue-700">Tier 2</div>
                <div className="text-xl font-semibold text-blue-800">{capabilitySummary.tier2}</div>
              </div>
              <div className="p-3 bg-orange-50 rounded-lg">
                <div className="text-orange-700">Tier 3</div>
                <div className="text-xl font-semibold text-orange-800">{capabilitySummary.tier3}</div>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <div className="text-purple-700">Avg Score</div>
                <div className="text-xl font-semibold text-purple-800">{capabilitySummary.averageCompositeScore.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

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
