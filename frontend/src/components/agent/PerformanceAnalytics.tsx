import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, PieChart, Calendar, DollarSign, Percent, Target } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

interface PerformanceData {
  total_pnl: number;
  total_pnl_percent: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  max_drawdown: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  daily_pnl: { date: string; pnl: number; cumulative_pnl: number }[];
  strategy_performance: { strategy_name: string; pnl: number; trades: number; win_rate: number }[];
  symbol_performance: { symbol: string; pnl: number; trades: number; win_rate: number }[];
  hourly_distribution: { hour: number; trades: number; avg_pnl: number }[];
}

interface PerformanceAnalyticsProps {
  agentStatus?: string;
  timeRange?: '24h' | '7d' | '30d' | 'all';
}

const PerformanceAnalytics: React.FC<PerformanceAnalyticsProps> = ({ 
  agentStatus,
  timeRange = '7d'
}) => {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [selectedRange, setSelectedRange] = useState(timeRange);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPerformanceData();
    
    if (agentStatus === 'running') {
      const interval = setInterval(() => {
        fetchPerformanceData();
      }, 30000); // Update every 30 seconds

      return () => clearInterval(interval);
    }
  }, [agentStatus, selectedRange]);

  const fetchPerformanceData = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(
        `${API_BASE_URL}/api/agent/performance?range=${selectedRange}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        setData(response.data.performance);
      }
    } catch (err: any) {
      console.error('Error fetching performance data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getPnLColor = (pnl: number) => {
    if (pnl > 0) return 'text-green-600';
    if (pnl < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const renderDailyPnLChart = () => {
    if (!data || !data.daily_pnl || data.daily_pnl.length === 0) return null;

    const maxPnl = Math.max(...data.daily_pnl.map(d => Math.abs(d.pnl)));
    const chartHeight = 200;

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          Daily P&L
        </h4>
        <div className="relative" style={{ height: `${chartHeight}px` }}>
          <svg className="w-full h-full" viewBox={`0 0 ${data.daily_pnl.length * 40} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
            {/* Zero line */}
            <line
              x1="0"
              y1={chartHeight / 2}
              x2={data.daily_pnl.length * 40}
              y2={chartHeight / 2}
              stroke="#9ca3af"
              strokeWidth="1"
              strokeDasharray="4"
            />

            {/* Bars */}
            {data.daily_pnl.map((day, idx) => {
              const barHeight = (Math.abs(day.pnl) / maxPnl) * (chartHeight / 2 - 10);
              const x = idx * 40 + 10;
              const y = day.pnl >= 0 ? chartHeight / 2 - barHeight : chartHeight / 2;
              const color = day.pnl >= 0 ? '#10b981' : '#ef4444';

              return (
                <g key={idx}>
                  <rect
                    x={x}
                    y={y}
                    width="20"
                    height={barHeight}
                    fill={color}
                    opacity="0.8"
                    rx="2"
                  />
                  <text
                    x={x + 10}
                    y={chartHeight - 5}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#6b7280"
                  >
                    {new Date(day.date).getDate()}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  const renderCumulativePnLChart = () => {
    if (!data || !data.daily_pnl || data.daily_pnl.length === 0) return null;

    const maxCumPnl = Math.max(...data.daily_pnl.map(d => d.cumulative_pnl));
    const minCumPnl = Math.min(...data.daily_pnl.map(d => d.cumulative_pnl));
    const range = maxCumPnl - minCumPnl;
    const padding = range * 0.1;

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" />
          Cumulative P&L
        </h4>
        <div className="relative h-48">
          <svg className="w-full h-full" viewBox="0 0 800 150" preserveAspectRatio="none">
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((percent) => (
              <line
                key={percent}
                x1="0"
                y1={(percent / 100) * 150}
                x2="800"
                y2={(percent / 100) * 150}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
            ))}

            {/* Cumulative P&L line */}
            <polyline
              points={data.daily_pnl.map((day, idx) => {
                const x = (idx / (data.daily_pnl.length - 1)) * 800;
                const y = 150 - ((day.cumulative_pnl - minCumPnl + padding) / (range + 2 * padding)) * 150;
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke={data.total_pnl >= 0 ? '#10b981' : '#ef4444'}
              strokeWidth="3"
            />

            {/* Area fill */}
            <polygon
              points={`
                0,150
                ${data.daily_pnl.map((day, idx) => {
                  const x = (idx / (data.daily_pnl.length - 1)) * 800;
                  const y = 150 - ((day.cumulative_pnl - minCumPnl + padding) / (range + 2 * padding)) * 150;
                  return `${x},${y}`;
                }).join(' ')}
                800,150
              `}
              fill={data.total_pnl >= 0 ? '#10b981' : '#ef4444'}
              opacity="0.2"
            />
          </svg>
        </div>
      </div>
    );
  };

  const renderStrategyPerformance = () => {
    if (!data || !data.strategy_performance || data.strategy_performance.length === 0) return null;

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-purple-600" />
          Strategy Performance
        </h4>
        <div className="space-y-3">
          {data.strategy_performance.map((strategy, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900">
                    {strategy.strategy_name}
                  </span>
                  <span className={`text-sm font-bold ${getPnLColor(strategy.pnl)}`}>
                    ${strategy.pnl.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-600">
                  <span>{strategy.trades} trades</span>
                  <span>Win rate: {strategy.win_rate.toFixed(1)}%</span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${strategy.pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, (strategy.win_rate / 100) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSymbolPerformance = () => {
    if (!data || !data.symbol_performance || data.symbol_performance.length === 0) return null;

    const maxPnl = Math.max(...data.symbol_performance.map(s => Math.abs(s.pnl)));

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <PieChart className="w-4 h-4 text-orange-600" />
          Symbol Performance
        </h4>
        <div className="space-y-3">
          {data.symbol_performance.map((symbol, idx) => (
            <div key={idx}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-900">{symbol.symbol}</span>
                <span className={`text-sm font-bold ${getPnLColor(symbol.pnl)}`}>
                  ${symbol.pnl.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
                <span>{symbol.trades} trades</span>
                <span>Win rate: {symbol.win_rate.toFixed(1)}%</span>
              </div>
              {/* Horizontal bar */}
              <div className="h-6 bg-gray-100 rounded-lg overflow-hidden relative">
                <div
                  className={`h-full ${symbol.pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${(Math.abs(symbol.pnl) / maxPnl) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading performance analytics...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          No Performance Data
        </h3>
        <p className="text-gray-500">
          Performance analytics will appear once trading activity begins
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Time Range Selector */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            Performance Analytics
          </h3>
          <div className="flex gap-2">
            {['24h', '7d', '30d', 'all'].map((range) => (
              <button
                key={range}
                onClick={() => setSelectedRange(range as any)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  selectedRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {range === '24h' ? '24 Hours' : range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : 'All Time'}
              </button>
            ))}
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
            <p className="text-xs text-green-700 font-semibold mb-1">Total P&L</p>
            <p className={`text-2xl font-bold ${getPnLColor(data.total_pnl)}`}>
              ${data.total_pnl.toFixed(2)}
            </p>
            <p className={`text-xs ${getPnLColor(data.total_pnl)} mt-1`}>
              {data.total_pnl_percent >= 0 ? '+' : ''}{data.total_pnl_percent.toFixed(2)}%
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 font-semibold mb-1">Total Trades</p>
            <p className="text-2xl font-bold text-gray-900">{data.total_trades}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 font-semibold mb-1">Win Rate</p>
            <p className={`text-2xl font-bold ${data.win_rate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
              {data.win_rate.toFixed(1)}%
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 font-semibold mb-1">Profit Factor</p>
            <p className={`text-2xl font-bold ${data.profit_factor >= 1.5 ? 'text-green-600' : 'text-orange-600'}`}>
              {data.profit_factor.toFixed(2)}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 font-semibold mb-1">Sharpe Ratio</p>
            <p className={`text-2xl font-bold ${data.sharpe_ratio >= 1 ? 'text-green-600' : 'text-orange-600'}`}>
              {data.sharpe_ratio.toFixed(2)}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 font-semibold mb-1">Max Drawdown</p>
            <p className="text-2xl font-bold text-red-600">
              {data.max_drawdown.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderDailyPnLChart()}
        {renderCumulativePnLChart()}
        {renderStrategyPerformance()}
        {renderSymbolPerformance()}
      </div>

      {/* Trade Statistics */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h4 className="text-lg font-bold text-gray-900 mb-4">Trade Statistics</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-xs text-green-700 font-semibold mb-1">Winning Trades</p>
            <p className="text-2xl font-bold text-green-600">{data.winning_trades}</p>
            <p className="text-xs text-green-600 mt-1">Avg: ${data.avg_win.toFixed(2)}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-xs text-red-700 font-semibold mb-1">Losing Trades</p>
            <p className="text-2xl font-bold text-red-600">{data.losing_trades}</p>
            <p className="text-xs text-red-600 mt-1">Avg: ${Math.abs(data.avg_loss).toFixed(2)}</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-xs text-green-700 font-semibold mb-1">Best Trade</p>
            <p className="text-2xl font-bold text-green-600">${data.best_trade.toFixed(2)}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-xs text-red-700 font-semibold mb-1">Worst Trade</p>
            <p className="text-2xl font-bold text-red-600">${Math.abs(data.worst_trade).toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceAnalytics;
