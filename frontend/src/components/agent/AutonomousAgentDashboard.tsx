import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Activity, Brain, TrendingUp, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

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
      const token = localStorage.getItem('token');
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
        await fetchActivity();
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
        return 'text-green-400';
      case 'paused':
        return 'text-yellow-400';
      case 'stopped':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStrategyStatusColor = (status: string) => {
    switch (status) {
      case 'live':
        return 'bg-green-500/20 text-green-400';
      case 'paper_trading':
        return 'bg-blue-500/20 text-blue-400';
      case 'backtested':
        return 'bg-purple-500/20 text-purple-400';
      case 'generated':
        return 'bg-gray-500/20 text-gray-400';
      case 'retired':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Brain className="w-8 h-8 text-purple-400" />
            Autonomous Trading Agent
          </h1>
          <p className="text-gray-400 mt-2">
            AI-powered autonomous trading system using Claude Sonnet 4.5
          </p>
        </div>

        <div className="flex items-center gap-3">
          {agentStatus?.status === 'running' ? (
            <>
              <button
                onClick={pauseAgent}
                disabled={loading}
                className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Pause className="w-5 h-5" />
                Pause
              </button>
              <button
                onClick={stopAgent}
                disabled={loading}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Square className="w-5 h-5" />
                Stop
              </button>
            </>
          ) : (
            <button
              onClick={startAgent}
              disabled={loading}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Play className="w-5 h-5" />
              Start Agent
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-400 font-semibold">Error</h3>
            <p className="text-red-300 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Status</span>
            <Activity className={`w-5 h-5 ${getStatusColor(agentStatus?.status)}`} />
          </div>
          <p className={`text-2xl font-bold ${getStatusColor(agentStatus?.status)}`}>
            {agentStatus?.status || 'Stopped'}
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Strategies Generated</span>
            <Brain className="w-5 h-5 text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {agentStatus?.strategiesGenerated || 0}
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Live Strategies</span>
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {agentStatus?.liveTradesExecuted || 0}
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Total P&L</span>
            <TrendingUp className={`w-5 h-5 ${(agentStatus?.totalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`} />
          </div>
          <p className={`text-2xl font-bold ${(agentStatus?.totalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${(agentStatus?.totalPnl || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Strategies Table */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Generated Strategies</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Strategy Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Backtest Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Paper Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {strategies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                    No strategies generated yet. Start the agent to begin.
                  </td>
                </tr>
              ) : (
                strategies.map((strategy) => (
                  <tr key={strategy.id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">
                      {strategy.strategy_name}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStrategyStatusColor(strategy.status)}`}>
                        {strategy.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white">
                      {strategy.backtest_score ? strategy.backtest_score.toFixed(2) : '-'}
                    </td>
                    <td className="px-6 py-4 text-white">
                      {strategy.paper_trading_score ? strategy.paper_trading_score.toFixed(2) : '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {new Date(strategy.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity Log */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Recent Activity</h2>
        </div>
        <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
          {activity.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No activity yet</p>
          ) : (
            activity.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg">
                <Activity className="w-4 h-4 text-purple-400 flex-shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">{item.description}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AutonomousAgentDashboard;
