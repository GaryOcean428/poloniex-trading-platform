import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, _DollarSign, Target, _AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  current_price: number;
  quantity: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  stop_loss: number;
  take_profit: number;
  opened_at: Date;
}

interface ActiveStrategy {
  id: string;
  strategy_name: string;
  status: 'live' | 'paper_trading';
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  total_pnl_percent: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  sharpe_ratio: number;
  max_drawdown: number;
  current_drawdown: number;
  positions: Position[];
  last_trade_at?: Date;
  activated_at: Date;
}

interface ActiveStrategiesPanelProps {
  agentStatus?: string;
}

const ActiveStrategiesPanel: React.FC<ActiveStrategiesPanelProps> = ({ agentStatus }) => {
  const [strategies, setStrategies] = useState<ActiveStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  useEffect(() => {
    if (agentStatus === 'running') {
      fetchActiveStrategies();
      
      const interval = setInterval(() => {
        fetchActiveStrategies();
      }, 5000); // Update every 5 seconds

      return () => clearInterval(interval);
    }
  }, [agentStatus]);

  const fetchActiveStrategies = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategies/active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setStrategies(response.data.strategies);
      }
    } catch (_err: any) {
      // console.error('Error fetching active strategies:', err);
    } finally {
      setLoading(false);
    }
  };

  const getPnLColor = (pnl: number) => {
    if (pnl > 0) return 'text-green-600';
    if (pnl < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const getPnLBgColor = (pnl: number) => {
    if (pnl > 0) return 'bg-green-50 border-green-200';
    if (pnl < 0) return 'bg-red-50 border-red-200';
    return 'bg-gray-50 border-gray-200';
  };

  const getDrawdownColor = (drawdown: number, maxDrawdown: number) => {
    const ratio = drawdown / maxDrawdown;
    if (ratio > 0.8) return 'text-red-600';
    if (ratio > 0.5) return 'text-orange-600';
    return 'text-green-600';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading active strategies...</p>
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          No Active Strategies
        </h3>
        <p className="text-gray-500">
          Strategies will appear here once they pass backtesting and paper trading validation
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {strategies.map((strategy) => (
        <div 
          key={strategy.id}
          className="bg-white rounded-lg shadow-lg overflow-hidden"
        >
          {/* Strategy Header */}
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold flex items-center gap-2">
                  <Activity className="w-6 h-6" />
                  {strategy.strategy_name}
                </h3>
                <p className="text-sm opacity-90 mt-1">
                  Active since {new Date(strategy.activated_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm opacity-90">Total P&L</p>
                  <p className={`text-3xl font-bold ${strategy.total_pnl >= 0 ? 'text-white' : 'text-red-200'}`}>
                    ${strategy.total_pnl.toFixed(2)}
                  </p>
                  <p className="text-sm opacity-90">
                    ({strategy.total_pnl_percent >= 0 ? '+' : ''}{strategy.total_pnl_percent.toFixed(2)}%)
                  </p>
                </div>
                <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
                  strategy.status === 'live' 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-blue-100 text-blue-700'
                }`}>
                  {strategy.status === 'live' ? 'LIVE' : 'PAPER'}
                </span>
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="p-6 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-4">Performance Metrics</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-600 mb-1">Total Trades</p>
                <p className="text-lg font-bold text-gray-900">{strategy.total_trades}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-600 mb-1">Win Rate</p>
                <p className={`text-lg font-bold ${strategy.win_rate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                  {strategy.win_rate.toFixed(1)}%
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-600 mb-1">Profit Factor</p>
                <p className={`text-lg font-bold ${strategy.profit_factor >= 1.5 ? 'text-green-600' : 'text-orange-600'}`}>
                  {strategy.profit_factor.toFixed(2)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-600 mb-1">Sharpe Ratio</p>
                <p className={`text-lg font-bold ${strategy.sharpe_ratio >= 1 ? 'text-green-600' : 'text-orange-600'}`}>
                  {strategy.sharpe_ratio.toFixed(2)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-600 mb-1">Max Drawdown</p>
                <p className="text-lg font-bold text-red-600">
                  {strategy.max_drawdown.toFixed(1)}%
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-600 mb-1">Current DD</p>
                <p className={`text-lg font-bold ${getDrawdownColor(strategy.current_drawdown, strategy.max_drawdown)}`}>
                  {strategy.current_drawdown.toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Win/Loss Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-xs text-green-700 font-semibold">Winning Trades</p>
                </div>
                <p className="text-lg font-bold text-green-600">{strategy.winning_trades}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <p className="text-xs text-red-700 font-semibold">Losing Trades</p>
                </div>
                <p className="text-lg font-bold text-red-600">{strategy.losing_trades}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <p className="text-xs text-green-700 font-semibold">Avg Win</p>
                </div>
                <p className="text-lg font-bold text-green-600">${strategy.avg_win.toFixed(2)}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-4 h-4 text-red-600" />
                  <p className="text-xs text-red-700 font-semibold">Avg Loss</p>
                </div>
                <p className="text-lg font-bold text-red-600">${Math.abs(strategy.avg_loss).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Open Positions */}
          {strategy.positions.length > 0 && (
            <div className="p-6">
              <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-600" />
                Open Positions ({strategy.positions.length})
              </h4>
              <div className="space-y-3">
                {strategy.positions.map((position) => (
                  <div 
                    key={position.id}
                    className={`border rounded-lg p-4 ${getPnLBgColor(position.unrealized_pnl)}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                          position.side === 'long' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {position.side.toUpperCase()}
                        </div>
                        <h5 className="text-lg font-bold text-gray-900">{position.symbol}</h5>
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-bold ${getPnLColor(position.unrealized_pnl)}`}>
                          ${position.unrealized_pnl.toFixed(2)}
                        </p>
                        <p className={`text-sm ${getPnLColor(position.unrealized_pnl)}`}>
                          ({position.unrealized_pnl_percent >= 0 ? '+' : ''}{position.unrealized_pnl_percent.toFixed(2)}%)
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div>
                        <p className="text-gray-600 text-xs mb-1">Entry Price</p>
                        <p className="font-semibold text-gray-900">${position.entry_price.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 text-xs mb-1">Current Price</p>
                        <p className="font-semibold text-gray-900">${position.current_price.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 text-xs mb-1">Quantity</p>
                        <p className="font-semibold text-gray-900">{position.quantity}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 text-xs mb-1">Stop Loss</p>
                        <p className="font-semibold text-red-600">${position.stop_loss.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 text-xs mb-1">Take Profit</p>
                        <p className="font-semibold text-green-600">${position.take_profit.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-500">
                        Opened {new Date(position.opened_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No Positions State */}
          {strategy.positions.length === 0 && (
            <div className="p-6 text-center">
              <Target className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No open positions</p>
              <p className="text-gray-400 text-xs mt-1">
                Strategy is monitoring markets for entry opportunities
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ActiveStrategiesPanel;
