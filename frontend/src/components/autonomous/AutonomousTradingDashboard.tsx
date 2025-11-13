import React, { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, DollarSign, Target, Zap, Play, Pause, Settings, BarChart3, Brain, AlertCircle, TestTube, Rocket } from 'lucide-react';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';

interface AutonomousConfig {
  initialCapital: number;
  maxRiskPerTrade: number;
  maxDrawdown: number;
  targetDailyReturn: number;
  symbols: string[];
  paperTrading: boolean;
}

interface PerformanceMetrics {
  currentEquity: number;
  totalReturn: number;
  drawdown: number;
}

interface Trade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  pnlPercentage: number | null;
  status: 'open' | 'closed';
  exitReason: string | null;
  entryTime: string;
  exitTime: string | null;
  confidence: number;
  reason: string;
}

interface Statistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: string;
  avgPnL: number;
  totalPnL: number;
  bestTrade: number;
  worstTrade: number;
}

export default function AutonomousTradingDashboard() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutonomousConfig | null>(null);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [openPositions, setOpenPositions] = useState(0);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paperTrading, setPaperTrading] = useState(true);

  const fetchStatus = async () => {
    try {
      const token = getAccessToken();
      if (!token) {
        setError('Please log in to use autonomous trading');
        setLoading(false);
        return;
      }

      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/api/autonomous/status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch status');
      }

      const data = await response.json();
      
      if (data.success) {
        setEnabled(data.enabled);
        setConfig(data.config);
        setMetrics(data.metrics);
        setOpenPositions(data.openPositions);
        setRecentTrades(data.recentTrades || []);
        setPaperTrading(data.config?.paperTrading !== false); // Default to true
        setError(null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPerformance = async () => {
    try {
      const token = getAccessToken();
      if (!token) return;

      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/api/autonomous/performance?days=30`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setStatistics(data.statistics);
        }
      }
    } catch (err) {
      console.error('Failed to fetch performance:', err);
    }
  };

  const toggleAutonomousTrading = async () => {
    try {
      const token = getAccessToken();
      if (!token) return;

      const backendUrl = getBackendUrl();
      const endpoint = enabled ? '/api/autonomous/disable' : '/api/autonomous/enable';
      
      const response = await fetch(`${backendUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          maxRiskPerTrade: 2,
          maxDrawdown: 10,
          targetDailyReturn: 1,
          symbols: ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP'],
          paperTrading: paperTrading
        })
      });

      if (response.ok) {
        await fetchStatus();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to toggle autonomous trading');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchPerformance();
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchStatus();
      fetchPerformance();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`p-3 rounded-full ${enabled ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-700'}`}>
              <Brain className={`h-8 w-8 ${enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Autonomous Trading AI
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {enabled ? (
                  <span className="flex items-center space-x-2">
                    <span>System is actively trading</span>
                    {config?.paperTrading ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        <TestTube className="h-3 w-3 mr-1" />
                        Paper Trading
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <Rocket className="h-3 w-3 mr-1" />
                        Live Trading
                      </span>
                    )}
                  </span>
                ) : 'System is inactive'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {!enabled && (
              <div className="flex items-center space-x-3 bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mode:</span>
                <button
                  onClick={() => setPaperTrading(true)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    paperTrading
                      ? 'bg-blue-500 text-white'
                      : 'bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-500'
                  }`}
                >
                  <TestTube className="h-4 w-4 inline mr-1" />
                  Paper
                </button>
                <button
                  onClick={() => setPaperTrading(false)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    !paperTrading
                      ? 'bg-green-500 text-white'
                      : 'bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-500'
                  }`}
                >
                  <Rocket className="h-4 w-4 inline mr-1" />
                  Live
                </button>
              </div>
            )}
            
            <button
            onClick={toggleAutonomousTrading}
            className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-semibold transition-colors ${
              enabled
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {enabled ? (
              <>
                <Pause className="h-5 w-5" />
                <span>Stop Trading</span>
              </>
            ) : (
              <>
                <Play className="h-5 w-5" />
                <span>Start Trading</span>
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Performance Metrics */}
      {enabled && metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Current Equity</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  ${metrics.currentEquity.toFixed(2)}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Return</p>
                <p className={`text-2xl font-bold ${metrics.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {metrics.totalReturn >= 0 ? '+' : ''}{metrics.totalReturn.toFixed(2)}%
                </p>
              </div>
              {metrics.totalReturn >= 0 ? (
                <TrendingUp className="h-8 w-8 text-green-500" />
              ) : (
                <TrendingDown className="h-8 w-8 text-red-500" />
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Drawdown</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {metrics.drawdown.toFixed(2)}%
                </p>
              </div>
              <Target className="h-8 w-8 text-orange-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Open Positions</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {openPositions}
                </p>
              </div>
              <Activity className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>
      )}

      {/* Configuration */}
      {config && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
            <Settings className="h-5 w-5 mr-2" />
            Trading Configuration
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Initial Capital</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                ${config.initialCapital.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Risk Per Trade</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {config.maxRiskPerTrade}%
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Max Drawdown</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {config.maxDrawdown}%
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Daily Target</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {config.targetDailyReturn}%
              </p>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Trading Symbols</p>
            <div className="flex flex-wrap gap-2">
              {config.symbols.map(symbol => (
                <span
                  key={symbol}
                  className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium"
                >
                  {symbol.replace('_PERP', '')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      {statistics && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Performance Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Trades</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {statistics.totalTrades}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Win Rate</p>
              <p className="text-lg font-semibold text-green-600">
                {statistics.winRate}%
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg P&L</p>
              <p className={`text-lg font-semibold ${statistics.avgPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${statistics.avgPnL.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total P&L</p>
              <p className={`text-lg font-semibold ${statistics.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${statistics.totalPnL.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
            <Zap className="h-5 w-5 mr-2" />
            Recent AI-Generated Trades
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Trades executed automatically by the AI system
          </p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Symbol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Side
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Entry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Exit
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  P&L
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Confidence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {recentTrades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    {enabled ? 'No trades yet. AI is analyzing markets...' : 'Start autonomous trading to see AI-generated trades'}
                  </td>
                </tr>
              ) : (
                recentTrades.map(trade => (
                  <tr key={trade.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {trade.symbol.replace('_PERP', '')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        trade.side === 'long'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}>
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      ${trade.entryPrice.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {trade.pnl !== null ? (
                        <span className={`text-sm font-semibold ${trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} ({trade.pnlPercentage?.toFixed(2)}%)
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        trade.status === 'open'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                      }`}>
                        {trade.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {trade.confidence}%
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                      {trade.reason}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paper vs Live Trading Info */}
      {!enabled && (
        <>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
              How Autonomous Trading Works
            </h3>
            <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
              <p>✓ <strong>AI analyzes markets 24/7</strong> - Continuously monitors BTC, ETH, SOL and other pairs</p>
              <p>✓ <strong>Generates trading signals</strong> - Uses ML predictions + technical analysis (70%+ confidence required)</p>
              <p>✓ <strong>Executes trades automatically</strong> - Places orders, sets stop loss & take profit</p>
              <p>✓ <strong>Manages risk</strong> - 2% risk per trade, 10% max drawdown, max 3 positions</p>
              <p>✓ <strong>Self-optimizes</strong> - Learns from performance and adjusts strategies</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
              <div className="flex items-center space-x-2 mb-3">
                <TestTube className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                  Paper Trading Mode
                </h3>
              </div>
              <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
                <p>✓ <strong>Risk-free testing</strong> - No real money at risk</p>
                <p>✓ <strong>Virtual $10,000 capital</strong> - Test strategies safely</p>
                <p>✓ <strong>Real market data</strong> - Simulates actual trading conditions</p>
                <p>✓ <strong>Track performance</strong> - See how strategies perform</p>
                <p className="mt-3 font-semibold text-blue-900 dark:text-blue-100">
                  Recommended for first-time users!
                </p>
              </div>
            </div>

            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
              <div className="flex items-center space-x-2 mb-3">
                <Rocket className="h-5 w-5 text-green-600 dark:text-green-400" />
                <h3 className="text-lg font-semibold text-green-900 dark:text-green-100">
                  Live Trading Mode
                </h3>
              </div>
              <div className="space-y-2 text-sm text-green-800 dark:text-green-200">
                <p>✓ <strong>Real money trading</strong> - Actual profits and losses</p>
                <p>✓ <strong>Uses your Futures balance</strong> - Requires funded account</p>
                <p>✓ <strong>Automatic execution</strong> - Places real orders on Poloniex</p>
                <p>⚠️ <strong>Risk warning</strong> - Can result in financial loss</p>
                <p className="mt-3 font-semibold text-green-900 dark:text-green-100">
                  Only use after testing in Paper mode!
                </p>
              </div>
            </div>
          </div>

          {!paperTrading && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-6 w-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                    Live Trading Warning
                  </h3>
                  <div className="space-y-2 text-sm text-yellow-800 dark:text-yellow-200">
                    <p>You are about to enable <strong>LIVE TRADING</strong> with real money.</p>
                    <p>Before proceeding, ensure:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>You have tested strategies in Paper Trading mode</li>
                      <li>You understand the risks of automated trading</li>
                      <li>Your Poloniex Futures account is funded</li>
                      <li>Your API keys have trading permissions</li>
                      <li>You can afford to lose the capital you're risking</li>
                    </ul>
                    <p className="mt-3 font-semibold">
                      Cryptocurrency trading carries substantial risk. Only trade with money you can afford to lose.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
