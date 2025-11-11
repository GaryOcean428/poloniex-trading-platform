import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Activity, Brain, TrendingUp, AlertCircle } from 'lucide-react';
import axios from 'axios';

// Auto-detect API URL based on environment
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

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

  useEffect(() => {
    fetchAgentStatus();
    const interval = setInterval(() => {
      fetchAgentStatus();
      fetchActivity();
      fetchStrategies();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, []);

  const fetchAgentStatus = async () => {
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
      const response = await axios.get(`${API_BASE_URL}/api/agent/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setAgentStatus(response.data.status);
      }
    } catch (err: any) {
      console.error('Error fetching agent status:', err);
    }
  };

  const fetchActivity = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/api/agent/activity?limit=20`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setActivity(response.data.activity);
      }
    } catch (err: any) {
      console.error('Error fetching activity:', err);
    }
  };

  const fetchStrategies = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategies`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setStrategies(response.data.strategies);
      }
    } catch (err: any) {
      console.error('Error fetching strategies:', err);
    }
  };

  const startAgent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/start`,
        config,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        setAgentStatus(response.data.session);
        await fetchAgentStatus();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start agent');
    } finally {
      setLoading(false);
    }
  };

  const stopAgent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/stop`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
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
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/pause`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
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

      {/* Status Overview - White Cards with Shadows */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        </div>

        <div 
          className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow"
          role="status"
          aria-label={`Live strategies: ${agentStatus?.liveTradesExecuted || 0}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Live Strategies</span>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {agentStatus?.liveTradesExecuted || 0}
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

      {/* Strategies Table - White Card */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Generated Strategies</h2>
        </div>
        <div className="overflow-x-auto">
          {strategies.length > 0 ? (
            <table 
              className="w-full"
              role="table"
              aria-label="Generated trading strategies"
            >
              <caption className="sr-only">List of AI-generated trading strategies with their performance metrics</caption>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Strategy Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Backtest Score
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Paper Score
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {strategies.map((strategy) => (
                  <tr 
                    key={strategy.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {strategy.strategy_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStrategyStatusColor(strategy.status)}`}>
                        {strategy.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {strategy.backtest_score.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {strategy.paper_trading_score?.toFixed(2) || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(strategy.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                No Strategies Yet
              </h3>
              <p className="text-gray-500 mb-6">
                Start the agent to begin generating AI-powered trading strategies
              </p>
              <button 
                onClick={startAgent}
                disabled={loading}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:shadow-lg transition-shadow disabled:opacity-50 focus:ring-4 focus:ring-blue-300 focus:outline-none"
              >
                Start Agent Now
              </button>
            </div>
          )}
        </div>
      </div>

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
