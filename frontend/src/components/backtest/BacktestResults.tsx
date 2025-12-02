import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, AlertTriangle } from 'lucide-react';

interface BacktestResultsData {
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
  trades?: Array<{
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    type: 'long' | 'short';
  }>;
}

interface Props {
  results: BacktestResultsData;
  strategyName: string;
  symbol: string;
}

export default function BacktestResults({ results, strategyName, symbol }: Props) {
  const getPerformanceRating = () => {
    const score = 
      (results.winRate * 30) + 
      (Math.min(results.profitFactor / 2, 1) * 30) +
      (Math.min(results.sharpeRatio / 2, 1) * 20) +
      (Math.max(0, 1 - results.maxDrawdown) * 20);
    
    if (score >= 80) return { label: 'Excellent', color: 'green', emoji: '🌟' };
    if (score >= 60) return { label: 'Good', color: 'blue', emoji: '👍' };
    if (score >= 40) return { label: 'Fair', color: 'yellow', emoji: '⚠️' };
    return { label: 'Poor', color: 'red', emoji: '❌' };
  };

  const rating = getPerformanceRating();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">
          {strategyName} - {symbol}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-3xl">{rating.emoji}</span>
          <div>
            <p className="text-sm opacity-90">Performance Rating</p>
            <p className="text-xl font-bold">{rating.label}</p>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Win Rate</span>
            <Target className="text-green-500" size={20} />
          </div>
          <p className="text-3xl font-bold text-green-600">
            {(results.winRate * 100).toFixed(1)}%
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {results.winningTrades} wins / {results.losingTrades} losses
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Profit Factor</span>
            <Activity className="text-blue-500" size={20} />
          </div>
          <p className="text-3xl font-bold text-blue-600">
            {results.profitFactor.toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {results.profitFactor >= 2 ? 'Excellent' : results.profitFactor >= 1.5 ? 'Good' : 'Needs improvement'}
          </p>
        </div>

        <div className={`bg-white rounded-lg shadow p-6 border-l-4 ${results.totalReturn >= 0 ? 'border-green-500' : 'border-red-500'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Total Return</span>
            <DollarSign className={results.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'} size={20} />
          </div>
          <p className={`text-3xl font-bold ${results.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {results.totalReturn >= 0 ? '+' : ''}{(results.totalReturn * 100).toFixed(2)}%
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Over {results.totalTrades} trades
          </p>
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Detailed Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-1">Sharpe Ratio</p>
            <p className="text-lg font-bold text-gray-900">{results.sharpeRatio.toFixed(2)}</p>
          </div>
          
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-1">Max Drawdown</p>
            <p className="text-lg font-bold text-red-600">-{(results.maxDrawdown * 100).toFixed(2)}%</p>
          </div>
          
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-1">Avg Win</p>
            <p className="text-lg font-bold text-green-600">+{results.averageWin.toFixed(2)}%</p>
          </div>
          
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-1">Avg Loss</p>
            <p className="text-lg font-bold text-red-600">{results.averageLoss.toFixed(2)}%</p>
          </div>
        </div>
      </div>

      {/* Risk Assessment */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
          <AlertTriangle className="text-yellow-500" size={20} />
          Risk Assessment
        </h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Drawdown Risk</span>
              <span className={`font-medium ${results.maxDrawdown < 0.1 ? 'text-green-600' : results.maxDrawdown < 0.2 ? 'text-yellow-600' : 'text-red-600'}`}>
                {results.maxDrawdown < 0.1 ? 'Low' : results.maxDrawdown < 0.2 ? 'Medium' : 'High'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${results.maxDrawdown < 0.1 ? 'bg-green-500' : results.maxDrawdown < 0.2 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(results.maxDrawdown * 100, 100)}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Consistency</span>
              <span className={`font-medium ${results.winRate >= 0.6 ? 'text-green-600' : results.winRate >= 0.5 ? 'text-yellow-600' : 'text-red-600'}`}>
                {results.winRate >= 0.6 ? 'High' : results.winRate >= 0.5 ? 'Medium' : 'Low'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${results.winRate >= 0.6 ? 'bg-green-500' : results.winRate >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${results.winRate * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Trade History */}
      {results.trades && results.trades.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">Recent Trades</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Type</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Entry</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Exit</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">P&L</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {results.trades.slice(0, 10).map((trade, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                        trade.type === 'long' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {trade.type === 'long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {trade.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-900">${trade.entryPrice.toFixed(2)}</td>
                    <td className="py-2 px-3 text-gray-900">${trade.exitPrice.toFixed(2)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                    </td>
                    <td className={`py-2 px-3 text-right font-medium ${trade.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recommendations */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3 text-blue-900">Recommendations</h3>
        <ul className="space-y-2 text-sm text-blue-800">
          {results.winRate < 0.5 && (
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span>Win rate is below 50%. Consider adjusting entry/exit conditions.</span>
            </li>
          )}
          {results.profitFactor < 1.5 && (
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span>Profit factor could be improved. Review risk/reward ratio.</span>
            </li>
          )}
          {results.maxDrawdown > 0.15 && (
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span>High drawdown detected. Consider tighter stop losses or position sizing.</span>
            </li>
          )}
          {results.sharpeRatio < 1 && (
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span>Low Sharpe ratio indicates high volatility. Consider risk management improvements.</span>
            </li>
          )}
          {results.winRate >= 0.6 && results.profitFactor >= 1.5 && results.maxDrawdown < 0.15 && (
            <li className="flex items-start gap-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span className="text-green-800">Strategy shows strong performance. Consider paper trading before going live.</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
