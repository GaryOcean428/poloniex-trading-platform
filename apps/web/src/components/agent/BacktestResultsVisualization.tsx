import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import { safeNum } from '@/utils/safeNum';
import axios from 'axios';
import { Activity, BarChart3, DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const API_BASE_URL = getBackendUrl();

interface BacktestTrade {
  date: string;
  type: 'entry' | 'exit';
  side: 'long' | 'short';
  price: number;
  pnl?: number;
  cumulative_pnl: number;
}

/**
 * Backtest result row as returned by `/api/agent/backtest/results`.
 *
 * Unit conventions (canonical; see apps/api/src/routes/agent.ts comment for
 * the authoritative spec):
 *   - total_return        : PERCENT form (e.g. 2.48 = 2.48%). Legacy rows are
 *                           fenced off server-side by engine_version check.
 *   - win_rate            : PERCENT form (e.g. 42.86 = 42.86%).
 *   - profit_factor       : RATIO (1.55 = 1.55x).
 *   - max_drawdown        : DOLLARS (absolute $ amount of peak-to-trough loss).
 *   - max_drawdown_percent: PERCENT form (5.89 = 5.89%).
 *   - sharpe_ratio        : RATIO (annualised).
 *   - initial_capital / final_value / avg_win / avg_loss / largest_* : DOLLARS.
 */
interface BacktestResult {
  id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  start_date: Date;
  end_date: Date;
  initial_capital: number;
  final_value: number;
  /** Return in PERCENT form. The API does not populate total_return_percent
   *  so `total_return` is the only percent field we render. */
  total_return: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  /** Win rate in PERCENT form (0–100). */
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  /** Drawdown in absolute DOLLARS. */
  max_drawdown: number;
  /** Drawdown in PERCENT form (0–100). */
  max_drawdown_percent: number;
  average_win: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  avg_trade_duration_hours: number;
  trades: BacktestTrade[];
  equity_curve: { date: string; equity: number; drawdown: number }[];
  created_at: Date;
}

interface BacktestResultsVisualizationProps {
  strategyId?: string;
}

const BacktestResultsVisualization: React.FC<BacktestResultsVisualizationProps> = ({ strategyId }) => {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBacktestResults();
  }, [strategyId]);

  const fetchBacktestResults = async () => {
    try {
      const token = getAccessToken();
      const url = strategyId
        ? `${API_BASE_URL}/api/agent/backtest/results?strategy_id=${strategyId}`
        : `${API_BASE_URL}/api/agent/backtest/results?limit=10`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        const results = response.data.results ?? [];
        setResults(results);
        if (results.length > 0 && !selectedResult) {
          setSelectedResult(results[0]);
        }
      }
    } catch (_err: unknown) {
      // console.error('Error fetching backtest results:', err);
    } finally {
      setLoading(false);
    }
  };

  const getReturnColor = (returnPercent: number) => {
    if (returnPercent > 0) return 'text-green-600';
    if (returnPercent < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const getReturnBgColor = (returnPercent: number) => {
    if (returnPercent > 0) return 'bg-green-50 border-green-200';
    if (returnPercent < 0) return 'bg-red-50 border-red-200';
    return 'bg-gray-50 border-gray-200';
  };

  const renderEquityCurve = (result: BacktestResult) => {
    if (!result.equity_curve || result.equity_curve.length === 0) return null;

    const maxEquity = Math.max(...result.equity_curve.map(p => p.equity));
    const minEquity = Math.min(...result.equity_curve.map(p => p.equity));
    const range = maxEquity - minEquity;
    const padding = range * 0.1;

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          Equity Curve
        </h4>
        <div className="relative h-64">
          <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="none">
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((percent) => (
              <line
                key={percent}
                x1="0"
                y1={200 - (percent * 2)}
                x2="800"
                y2={200 - (percent * 2)}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
            ))}

            {/* Equity line */}
            <polyline
              points={result.equity_curve.map((point, idx) => {
                const x = (idx / (result.equity_curve.length - 1)) * 800;
                const y = 200 - ((point.equity - minEquity + padding) / (range + 2 * padding)) * 200;
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
            />

            {/* Area fill */}
            <polygon
              points={`
                0,200
                ${result.equity_curve.map((point, idx) => {
                const x = (idx / (result.equity_curve.length - 1)) * 800;
                const y = 200 - ((point.equity - minEquity + padding) / (range + 2 * padding)) * 200;
                return `${x},${y}`;
              }).join(' ')}
                800,200
              `}
              fill="url(#equityGradient)"
              opacity="0.3"
            />

            {/* Gradient definition */}
            <defs>
              <linearGradient id="equityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
              </linearGradient>
            </defs>
          </svg>

          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-xs text-gray-500 -ml-12">
            <span>${safeNum(maxEquity).toFixed(0)}</span>
            <span>${safeNum((maxEquity + minEquity) / 2).toFixed(0)}</span>
            <span>${safeNum(minEquity).toFixed(0)}</span>
          </div>
        </div>

        {/* X-axis labels */}
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>{new Date(result.start_date).toLocaleDateString()}</span>
          <span>{new Date(result.end_date).toLocaleDateString()}</span>
        </div>
      </div>
    );
  };

  const renderDrawdownChart = (result: BacktestResult) => {
    if (!result.equity_curve || result.equity_curve.length === 0) return null;

    const maxDrawdown = Math.max(...result.equity_curve.map(p => Math.abs(p.drawdown)));

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-red-600" />
          Drawdown
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

            {/* Drawdown area */}
            <polygon
              points={`
                0,0
                ${result.equity_curve.map((point, idx) => {
                const x = (idx / (result.equity_curve.length - 1)) * 800;
                const y = (Math.abs(point.drawdown) / maxDrawdown) * 150;
                return `${x},${y}`;
              }).join(' ')}
                800,0
              `}
              fill="#ef4444"
              opacity="0.3"
            />

            {/* Drawdown line */}
            <polyline
              points={result.equity_curve.map((point, idx) => {
                const x = (idx / (result.equity_curve.length - 1)) * 800;
                const y = (Math.abs(point.drawdown) / maxDrawdown) * 150;
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
            />
          </svg>

          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-xs text-gray-500 -ml-12">
            <span>0%</span>
            <span>-{safeNum(maxDrawdown / 2).toFixed(1)}%</span>
            <span>-{safeNum(maxDrawdown).toFixed(1)}%</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading backtest results...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          No Backtest Results
        </h3>
        <p className="text-gray-500">
          Backtest results will appear here once strategies are tested against historical data
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Results Selector */}
      {results.length > 1 && (
        <div className="bg-white rounded-lg shadow-lg p-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Select Backtest Result
          </label>
          <select
            value={selectedResult?.id || ''}
            onChange={(e) => {
              const result = results.find(r => r.id === e.target.value);
              setSelectedResult(result || null);
            }}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {results.map((result) => (
              <option key={result.id} value={result.id}>
                {result.strategy_name} - {result.symbol} ({new Date(result.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedResult && (
        <>
          {/* Summary Card */}
          <div className={`rounded-lg border-2 p-6 ${getReturnBgColor(selectedResult.total_return)}`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{selectedResult.strategy_name}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedResult.symbol} • {selectedResult.timeframe} •
                  {new Date(selectedResult.start_date).toLocaleDateString()} - {new Date(selectedResult.end_date).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600 mb-1">Total Return</p>
                {/* total_return is already in PERCENT form — render as-is, no ×100 */}
                <p className={`text-4xl font-bold ${getReturnColor(selectedResult.total_return)}`}>
                  {selectedResult.total_return >= 0 ? '+' : ''}{safeNum(selectedResult.total_return).toFixed(2)}%
                </p>
                {/* Net $ = final_value − initial_capital */}
                <p className={`text-lg ${getReturnColor(selectedResult.total_return)}`}>
                  ${safeNum(selectedResult.final_value - selectedResult.initial_capital).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Total Trades</p>
                <p className="text-lg font-bold text-gray-900">{selectedResult.total_trades}</p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Win Rate</p>
                <p className={`text-lg font-bold ${selectedResult.win_rate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                  {safeNum(selectedResult.win_rate).toFixed(1)}%
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Profit Factor</p>
                <p className={`text-lg font-bold ${selectedResult.profit_factor >= 1.5 ? 'text-green-600' : 'text-orange-600'}`}>
                  {safeNum(selectedResult.profit_factor).toFixed(2)}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Sharpe Ratio</p>
                <p className={`text-lg font-bold ${selectedResult.sharpe_ratio >= 1 ? 'text-green-600' : 'text-orange-600'}`}>
                  {safeNum(selectedResult.sharpe_ratio).toFixed(2)}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Max Drawdown</p>
                <p className="text-lg font-bold text-red-600">
                  {safeNum(selectedResult.max_drawdown_percent).toFixed(1)}%
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Avg Duration</p>
                <p className="text-lg font-bold text-gray-900">
                  {safeNum(selectedResult.avg_trade_duration_hours).toFixed(1)}h
                </p>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {renderEquityCurve(selectedResult)}
            {renderDrawdownChart(selectedResult)}
          </div>

          {/* Trade Statistics */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              Trade Statistics
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs text-green-700 font-semibold mb-1">Winning Trades</p>
                <p className="text-2xl font-bold text-green-600">{selectedResult.winning_trades}</p>
                <p className="text-xs text-green-600 mt-1">
                  Avg: ${safeNum(selectedResult.average_win).toFixed(2)}
                </p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-xs text-red-700 font-semibold mb-1">Losing Trades</p>
                <p className="text-2xl font-bold text-red-600">{selectedResult.losing_trades}</p>
                <p className="text-xs text-red-600 mt-1">
                  Avg: ${safeNum(Math.abs(selectedResult.average_loss)).toFixed(2)}
                </p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs text-green-700 font-semibold mb-1">Largest Win</p>
                <p className="text-2xl font-bold text-green-600">${safeNum(selectedResult.largest_win).toFixed(2)}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-xs text-red-700 font-semibold mb-1">Largest Loss</p>
                <p className="text-2xl font-bold text-red-600">${safeNum(Math.abs(selectedResult.largest_loss)).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Capital Summary */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Capital Summary
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">Initial Capital</p>
                <p className="text-2xl font-bold text-gray-900">
                  ${safeNum(selectedResult.initial_capital).toFixed(2)}
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">Final Capital</p>
                <p className={`text-2xl font-bold ${getReturnColor(selectedResult.total_return)}`}>
                  ${safeNum(selectedResult.final_value).toFixed(2)}
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">Net Profit/Loss</p>
                {/* total_return is PERCENT; compute $ P&L from capitals */}
                <p className={`text-2xl font-bold ${getReturnColor(selectedResult.total_return)}`}>
                  {(() => {
                    const pnl = safeNum(selectedResult.final_value - selectedResult.initial_capital);
                    return `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
                  })()}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BacktestResultsVisualization;
