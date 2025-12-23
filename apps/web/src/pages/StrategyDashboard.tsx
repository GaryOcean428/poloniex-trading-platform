/**
 * Strategy Dashboard
 * 
 * Displays all AI-generated trading strategies with their performance metrics
 */

import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, Activity, CheckCircle, XCircle, RefreshCw, BarChart3 } from 'lucide-react';
import { getAccessToken } from '@/utils/auth';
import BacktestRunner from '@/components/backtest/BacktestRunner';
import PaperTradingToggle from '@/components/paper-trading/PaperTradingToggle';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8765';

interface Strategy {
  id: string;
  name: string;
  type: 'single' | 'combo';
  status: 'generated' | 'backtested' | 'paper_trading' | 'live' | 'retired';
  symbol: string;
  timeframe: string;
  indicators: string[];
  description: string;
  performance: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    totalReturn: number;
  };
  subStrategies?: {
    strategyId: string;
    weight: number;
  }[];
  createdAt: string;
  promotedAt?: string;
  retiredAt?: string;
}

const StrategyDashboard: React.FC = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'live' | 'paper' | 'backtest'>('all');
  
  useEffect(() => {
    fetchStrategies();
    const interval = setInterval(fetchStrategies, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);
  
  const fetchStrategies = async () => {
    try {
      const token = getAccessToken();
      if (!token) {
        setError('Please log in to view strategies');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_BASE}/api/agent/strategies`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch strategies');
      }

      const data = await response.json();
      setStrategies(data.strategies || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return 'bg-green-100 text-green-800 border-green-300';
      case 'paper_trading': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'backtested': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'generated': return 'bg-gray-100 text-gray-800 border-gray-300';
      case 'retired': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'live': return <CheckCircle className="h-4 w-4" />;
      case 'paper_trading': return <Activity className="h-4 w-4" />;
      case 'backtested': return <BarChart3 className="h-4 w-4" />;
      case 'retired': return <XCircle className="h-4 w-4" />;
      default: return <Brain className="h-4 w-4" />;
    }
  };
  
  const filteredStrategies = strategies.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'live') return s.status === 'live';
    if (filter === 'paper') return s.status === 'paper_trading';
    if (filter === 'backtest') return s.status === 'backtested';
    return true;
  });

  const stats = {
    total: strategies.length,
    live: strategies.filter(s => s.status === 'live').length,
    paper: strategies.filter(s => s.status === 'paper_trading').length,
    backtest: strategies.filter(s => s.status === 'backtested').length,
    retired: strategies.filter(s => s.status === 'retired').length
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={fetchStrategies}
            className="mt-2 text-red-600 hover:text-red-800 font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">AI Trading Strategies</h1>
        <p className="text-gray-600">
          Autonomous agent generates, tests, and deploys strategies automatically
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-600">Total</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="text-sm text-green-600">Live</div>
          <div className="text-2xl font-bold text-green-700">{stats.live}</div>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <div className="text-sm text-blue-600">Paper Trading</div>
          <div className="text-2xl font-bold text-blue-700">{stats.paper}</div>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
          <div className="text-sm text-yellow-600">Backtested</div>
          <div className="text-2xl font-bold text-yellow-700">{stats.backtest}</div>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <div className="text-sm text-red-600">Retired</div>
          <div className="text-2xl font-bold text-red-700">{stats.retired}</div>
        </div>
      </div>
      
      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'all', label: 'All Strategies' },
          { key: 'live', label: 'Live' },
          { key: 'paper', label: 'Paper Trading' },
          { key: 'backtest', label: 'Backtested' }
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as any)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white border text-gray-700 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      
      {/* Strategy Cards */}
      {filteredStrategies.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStrategies.map(strategy => (
            <div key={strategy.id} className="bg-white rounded-lg border p-4 hover:shadow-lg transition-shadow">
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">{strategy.name}</h3>
                  <p className="text-sm text-gray-600">{strategy.symbol} • {strategy.timeframe}</p>
                </div>
                <span className={`px-2 py-1 rounded-lg text-xs font-medium border flex items-center gap-1 ${getStatusColor(strategy.status)}`}>
                  {getStatusIcon(strategy.status)}
                  {strategy.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>
              
              {/* Type Badge */}
              {strategy.type === 'combo' && (
                <div className="mb-3 flex items-center gap-2 text-sm text-purple-600 bg-purple-50 px-2 py-1 rounded">
                  <Brain className="h-4 w-4" />
                  <span>Multi-Strategy Combo</span>
                </div>
              )}
              
              {/* Description */}
              <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                {strategy.description}
              </p>
              
              {/* Indicators */}
              <div className="mb-3">
                <div className="text-xs text-gray-600 mb-1">Indicators:</div>
                <div className="flex flex-wrap gap-1">
                  {strategy.indicators.map(ind => (
                    <span key={ind} className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                      {ind}
                    </span>
                  ))}
                </div>
              </div>
              
              {/* Sub-strategies (for combo) */}
              {strategy.subStrategies && strategy.subStrategies.length > 0 && (
                <div className="mb-3 border-t pt-2">
                  <div className="text-xs text-gray-600 mb-1">Components:</div>
                  {strategy.subStrategies.map((sub, i) => (
                    <div key={i} className="text-xs flex justify-between">
                      <span className="text-gray-700">Strategy {i + 1}</span>
                      <span className="text-gray-500 font-medium">{(sub.weight * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Performance */}
              <div className="grid grid-cols-2 gap-2 text-sm border-t pt-3">
                <div>
                  <div className="text-gray-600 text-xs">Win Rate</div>
                  <div className="font-semibold">{(strategy.performance.winRate * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-gray-600 text-xs">Profit Factor</div>
                  <div className="font-semibold">{strategy.performance.profitFactor.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-gray-600 text-xs">Total Trades</div>
                  <div className="font-semibold">{strategy.performance.totalTrades}</div>
                </div>
                <div>
                  <div className="text-gray-600 text-xs">Return</div>
                  <div className={`font-semibold ${strategy.performance.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.performance.totalReturn >= 0 ? '+' : ''}{strategy.performance.totalReturn.toFixed(2)}%
                  </div>
                </div>
              </div>
              
              {/* Timestamp */}
              <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                Created {new Date(strategy.createdAt).toLocaleDateString()}
                {strategy.promotedAt && (
                  <span className="ml-2">
                    • Promoted {new Date(strategy.promotedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="mt-3 pt-3 border-t space-y-2">
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-2">
                    <BarChart3 size={16} />
                    <span>Backtest Strategy</span>
                  </summary>
                  <div className="mt-3">
                    <BacktestRunner 
                      strategyId={strategy.id} 
                      strategyName={strategy.name}
                    />
                  </div>
                </details>
                
                <PaperTradingToggle 
                  strategyId={strategy.id}
                  strategyName={strategy.name}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg border">
          <Brain className="h-16 w-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Strategies Found</h3>
          <p className="text-gray-600 mb-4">
            {filter === 'all' 
              ? 'Start the autonomous agent to generate AI-powered trading strategies'
              : `No ${filter} strategies available`
            }
          </p>
          <button
            onClick={() => window.location.href = '/autonomous-agent'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Autonomous Trading
          </button>
        </div>
      )}
    </div>
  );
};

export default StrategyDashboard;
