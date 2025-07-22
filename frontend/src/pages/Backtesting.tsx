import React, { useState, useEffect } from 'react';
import { Strategy } from '@/types';
import { BacktestResult, BacktestOptions } from '@/types/backtest';
// import { backtestService } from '@/services/backtestService';
import { advancedBacktestService } from '@/services/advancedBacktestService';
import { useTradingContext } from '@/hooks/useTradingContext';
import HistoricalDataManager from '@/components/backtesting/HistoricalDataManager';
import { 
  Play, 
  Settings, 
  Download, 
  TrendingUp,
  AlertTriangle,
  BarChart3,
  PieChart,
  Activity,
  Zap,
  Database
} from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface AdvancedMetrics {
  valueAtRisk95: number;
  valueAtRisk99: number;
  conditionalVaR95: number;
  conditionalVaR99: number;
  calmarRatio: number;
  sortinoRatio: number;
  omegaRatio: number;
  tailRatio: number;
  gainToLossRatio: number;
  payoffRatio: number;
  expectancy: number;
  systemQualityNumber: number;
  kRatio: number;
  ulcerIndex: number;
  recoveryFactor: number;
  profitabilityIndex: number;
}

interface BacktestSession {
  id: string;
  name: string;
  strategy: Strategy;
  options: BacktestOptions;
  result: BacktestResult | null;
  advancedMetrics: AdvancedMetrics | null;
  createdAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const Backtesting: React.FC = () => {
  const { strategies } = useTradingContext();
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [backtestOptions, setBacktestOptions] = useState<BacktestOptions>({
    startDate: '2023-01-01',
    endDate: '2024-01-01',
    initialBalance: 10000,
    feeRate: 0.001,
    slippage: 0.001,
    useHistoricalData: true
  });
  
  const [sessions, setSessions] = useState<BacktestSession[]>([]);
  const [activeSession, setActiveSession] = useState<BacktestSession | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'data' | 'results' | 'analysis' | 'reports'>('setup');
  const [historicalDataLoaded, setHistoricalDataLoaded] = useState(false);

  // Initialize with sample session for demo
  useEffect(() => {
    if (strategies.length > 0 && sessions.length === 0) {
      const sampleSession: BacktestSession = {
        id: '1',
        name: 'Sample Backtest',
        strategy: strategies[0],
        options: backtestOptions,
        result: null,
        advancedMetrics: null,
        createdAt: new Date(),
        status: 'pending'
      };
      setSessions([sampleSession]);
    }
  }, [strategies, backtestOptions, sessions.length]);

  const runBacktest = async () => {
    if (!selectedStrategy) return;

    setIsRunning(true);
    
    const sessionId = Date.now().toString();
    const newSession: BacktestSession = {
      id: sessionId,
      name: `Backtest ${selectedStrategy.name} ${new Date().toLocaleDateString()}`,
      strategy: selectedStrategy,
      options: backtestOptions,
      result: null,
      advancedMetrics: null,
      createdAt: new Date(),
      status: 'running'
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveSession(newSession);

    try {
      // Use advanced backtest service for Phase 4
      const result = await advancedBacktestService.runAdvancedBacktest(selectedStrategy, backtestOptions);
      const advancedMetrics = result.advancedMetrics;

      const updatedSession = {
        ...newSession,
        result: {
          ...result,
          // Convert advanced metrics to the expected format
          metrics: {
            ...result.metrics,
            netProfit: result.totalPnL,
            grossProfit: result.trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0),
            grossLoss: Math.abs(result.trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)),
            maxConsecutiveWins: 0, // Would need to calculate
            maxConsecutiveLosses: 0, // Would need to calculate
            averageTrade: result.trades.reduce((sum, t) => sum + t.pnl, 0) / result.trades.length || 0,
            averageProfit: result.trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / result.trades.filter(t => t.pnl > 0).length || 0,
            averageLoss: result.trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0) / result.trades.filter(t => t.pnl < 0).length || 0,
            largestProfit: Math.max(...result.trades.map(t => t.pnl)),
            largestLoss: Math.min(...result.trades.map(t => t.pnl)),
            annualizedReturn: ((result.finalBalance / result.initialBalance) - 1) * 365 / 365 // Simplified
          }
        },
        advancedMetrics,
        status: 'completed' as const
      };

      setSessions(prev => prev.map(s => s.id === sessionId ? updatedSession : s));
      setActiveSession(updatedSession);
      setActiveTab('results');
    } catch (error) {
      console.error('Backtest failed:', error);
      const failedSession = {
        ...newSession,
        status: 'failed' as const
      };
      setSessions(prev => prev.map(s => s.id === sessionId ? failedSession : s));
    } finally {
      setIsRunning(false);
    }
  };

  // TODO: Implement advanced metrics calculation
  /*
  const calculateAdvancedMetrics = (result: BacktestResult): AdvancedMetrics => {
    const returns = result.trades.map(t => t.pnlPercent / 100);
    const negativeReturns = returns.filter(r => r < 0).sort((a, b) => a - b);
    const positiveReturns = returns.filter(r => r > 0);
    
    // Calculate Value at Risk (VaR)
    const calculateVaR = (confidence: number) => {
      const index = Math.floor((1 - confidence) * negativeReturns.length);
      return negativeReturns[index] || 0;
    };

    const var95 = calculateVaR(0.95);
    const var99 = calculateVaR(0.99);

    // Calculate Conditional VaR (Expected Shortfall)
    const calculateCVaR = (confidence: number) => {
      const varValue = calculateVaR(confidence);
      const tailReturns = negativeReturns.filter(r => r <= varValue);
      return tailReturns.length > 0 ? tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length : 0;
    };

    const cvar95 = calculateCVaR(0.95);
    const cvar99 = calculateCVaR(0.99);

    // Calculate other advanced metrics
    const downside = returns.filter(r => r < 0);
    const downsideDeviation = Math.sqrt(downside.reduce((sum, r) => sum + r * r, 0) / downside.length);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    
    const sortinoRatio = downsideDeviation > 0 ? avgReturn / downsideDeviation : 0;
    const calmarRatio = result.maxDrawdown > 0 ? (result.finalBalance - result.initialBalance) / result.initialBalance / result.maxDrawdown : 0;

    const wins = result.trades.filter(t => t.pnl > 0);
    const losses = result.trades.filter(t => t.pnl < 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;

    return {
      valueAtRisk95: Math.abs(var95) * 100,
      valueAtRisk99: Math.abs(var99) * 100,
      conditionalVaR95: Math.abs(cvar95) * 100,
      conditionalVaR99: Math.abs(cvar99) * 100,
      calmarRatio,
      sortinoRatio,
      omegaRatio: positiveReturns.length > 0 && negativeReturns.length > 0 
        ? (positiveReturns.reduce((sum, r) => sum + r, 0) / positiveReturns.length) / 
          (Math.abs(negativeReturns.reduce((sum, r) => sum + r, 0) / negativeReturns.length)) : 0,
      tailRatio: negativeReturns.length > 1 ? Math.abs(var95 / var99) : 0,
      gainToLossRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
      payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
      expectancy: (result.winRate / 100 * avgWin) - ((100 - result.winRate) / 100 * avgLoss),
      systemQualityNumber: result.sharpeRatio * Math.sqrt(result.totalTrades),
      kRatio: returns.length > 1 ? avgReturn / (Math.max(...returns) - Math.min(...returns)) : 0,
      ulcerIndex: Math.sqrt(result.trades.reduce((sum, t, i) => {
        const dd = result.trades.slice(0, i + 1).reduce((maxBalance, trade) => Math.max(maxBalance, trade.balance), 0);
        const drawdown = dd > 0 ? Math.pow((dd - t.balance) / dd * 100, 2) : 0;
        return sum + drawdown;
      }, 0) / result.trades.length),
      recoveryFactor: result.maxDrawdown > 0 ? (result.finalBalance - result.initialBalance) / result.maxDrawdown : 0,
      profitabilityIndex: result.initialBalance > 0 ? (result.finalBalance - result.initialBalance) / result.initialBalance : 0
    };
  };
  */

  const exportResults = async (format: 'csv' | 'pdf' | 'excel') => {
    if (!activeSession?.result) return;
    
    // Implement export functionality
    console.log(`Exporting results in ${format} format`);
    // This would integrate with a reporting service
  };

  const renderSetupTab = () => (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium mb-4 flex items-center">
          <Settings className="w-5 h-5 mr-2" />
          Backtest Configuration
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Strategy
            </label>
            <select
              value={selectedStrategy?.id || ''}
              onChange={(e) => {
                const strategy = strategies.find(s => s.id === e.target.value);
                setSelectedStrategy(strategy || null);
              }}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a strategy</option>
              {strategies.map(strategy => (
                <option key={strategy.id} value={strategy.id}>
                  {strategy.name} ({strategy.type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Initial Balance (USD)
            </label>
            <div className="space-y-2">
              <input
                type="number"
                min="100"
                max="1000000"
                step="100"
                value={backtestOptions.initialBalance}
                onChange={(e) => setBacktestOptions({
                  ...backtestOptions,
                  initialBalance: parseFloat(e.target.value) || 10000
                })}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter amount (min: $100)"
              />
              <div className="flex flex-wrap gap-2">
                {[1000, 5000, 10000, 25000, 50000, 100000].map(amount => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setBacktestOptions({
                      ...backtestOptions,
                      initialBalance: amount
                    })}
                    className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                      backtestOptions.initialBalance === amount
                        ? 'bg-blue-100 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    ${amount.toLocaleString()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                Choose a starting balance for your backtest simulation
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={backtestOptions.startDate}
              onChange={(e) => setBacktestOptions({
                ...backtestOptions,
                startDate: e.target.value
              })}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={backtestOptions.endDate}
              onChange={(e) => setBacktestOptions({
                ...backtestOptions,
                endDate: e.target.value
              })}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fee Rate (%)
            </label>
            <input
              type="number"
              step="0.001"
              value={backtestOptions.feeRate * 100}
              onChange={(e) => setBacktestOptions({
                ...backtestOptions,
                feeRate: parseFloat(e.target.value) / 100
              })}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Slippage (%)
            </label>
            <input
              type="number"
              step="0.001"
              value={backtestOptions.slippage * 100}
              onChange={(e) => setBacktestOptions({
                ...backtestOptions,
                slippage: parseFloat(e.target.value) / 100
              })}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={runBacktest}
            disabled={!selectedStrategy || isRunning}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4 mr-2" />
            {isRunning ? 'Running Backtest...' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {/* Session History */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium mb-4">Recent Sessions</h3>
        <div className="space-y-3">
          {sessions.slice(0, 5).map(session => (
            <div
              key={session.id}
              onClick={() => setActiveSession(session)}
              className={`p-4 border rounded-md cursor-pointer transition-colors ${
                activeSession?.id === session.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{session.name}</h4>
                  <p className="text-sm text-gray-600">
                    {session.strategy.name} • {session.createdAt.toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    session.status === 'completed' ? 'bg-green-100 text-green-800' :
                    session.status === 'running' ? 'bg-yellow-100 text-yellow-800' :
                    session.status === 'failed' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {session.status}
                  </span>
                  {session.result && (
                    <span className={`text-sm font-medium ${
                      session.result.totalPnL > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {session.result.totalPnL > 0 ? '+' : ''}${session.result.totalPnL.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderResultsTab = () => {
    if (!activeSession?.result) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <TrendingUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Results Available</h3>
          <p className="text-gray-600">Run a backtest to see results here.</p>
        </div>
      );
    }

    const result = activeSession.result;
    const metrics = activeSession.advancedMetrics;

    return (
      <div className="space-y-6">
        {/* Key Performance Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <TrendingUp className="w-8 h-8 text-green-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Total Return</p>
                <p className={`text-xl font-bold ${result.totalPnL > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {((result.finalBalance - result.initialBalance) / result.initialBalance * 100).toFixed(2)}%
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <BarChart3 className="w-8 h-8 text-blue-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Sharpe Ratio</p>
                <p className="text-xl font-bold">{result.sharpeRatio.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Max Drawdown</p>
                <p className="text-xl font-bold text-red-600">{result.maxDrawdown.toFixed(2)}%</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <Activity className="w-8 h-8 text-purple-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Win Rate</p>
                <p className="text-xl font-bold">{result.winRate.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Advanced Risk Metrics */}
        {metrics && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium mb-4">Advanced Risk Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">VaR (95%)</p>
                <p className="text-lg font-bold">{metrics.valueAtRisk95.toFixed(2)}%</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">CVaR (95%)</p>
                <p className="text-lg font-bold">{metrics.conditionalVaR95.toFixed(2)}%</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">Calmar Ratio</p>
                <p className="text-lg font-bold">{metrics.calmarRatio.toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">Sortino Ratio</p>
                <p className="text-lg font-bold">{metrics.sortinoRatio.toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">Omega Ratio</p>
                <p className="text-lg font-bold">{metrics.omegaRatio.toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">Expectancy</p>
                <p className="text-lg font-bold">${metrics.expectancy.toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">Ulcer Index</p>
                <p className="text-lg font-bold">{metrics.ulcerIndex.toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">Recovery Factor</p>
                <p className="text-lg font-bold">{metrics.recoveryFactor.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Equity Curve Chart */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Equity Curve</h3>
          <div className="h-64">
            <Line
              data={{
                labels: result.trades.map((_, i) => i + 1),
                datasets: [
                  {
                    label: 'Equity',
                    data: result.trades.map(t => t.balance),
                    borderColor: 'rgb(59, 130, 246)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.1,
                    fill: true
                  }
                ]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    beginAtZero: false
                  }
                }
              }}
            />
          </div>
        </div>

        {/* Trade Analysis */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Trade Analysis</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-3">P&L Distribution</h4>
              <div className="h-48">
                <Bar
                  data={{
                    labels: ['Winning Trades', 'Losing Trades'],
                    datasets: [
                      {
                        label: 'Count',
                        data: [result.winningTrades, result.losingTrades],
                        backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)'],
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false
                  }}
                />
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-3">Monthly Returns</h4>
              <div className="h-48">
                <Line
                  data={{
                    labels: result.metrics.monthlyReturns.map((_, i) => `Month ${i + 1}`),
                    datasets: [
                      {
                        label: 'Monthly Return',
                        data: result.metrics.monthlyReturns,
                        borderColor: 'rgb(168, 85, 247)',
                        backgroundColor: 'rgba(168, 85, 247, 0.1)',
                        tension: 0.1
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDataTab = () => (
    <div className="space-y-6">
      <HistoricalDataManager 
        onDataLoaded={(data) => {
          setHistoricalDataLoaded(true);
          console.log('Historical data loaded:', data);
        }}
      />
      
      {historicalDataLoaded && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex items-center">
            <Database className="w-5 h-5 text-green-600 mr-2" />
            <span className="text-sm text-green-700 font-medium">
              Historical data successfully loaded and ready for backtesting
            </span>
          </div>
        </div>
      )}
    </div>
  );

  const renderAnalysisTab = () => {
    if (!activeSession?.advancedMetrics) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <PieChart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Advanced Analysis</h3>
          <p className="text-gray-600">Run a backtest to see advanced analysis and risk metrics.</p>
        </div>
      );
    }

    const metrics = activeSession.advancedMetrics;

    return (
      <div className="space-y-6">
        {/* Risk Analysis */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Risk Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-red-50 p-4 rounded-lg">
              <h4 className="font-medium text-red-800 mb-2">Value at Risk</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-red-600">VaR (95%)</span>
                  <span className="font-bold text-red-800">{metrics.valueAtRisk95.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-red-600">VaR (99%)</span>
                  <span className="font-bold text-red-800">{metrics.valueAtRisk99.toFixed(2)}%</span>
                </div>
              </div>
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <h4 className="font-medium text-orange-800 mb-2">Conditional VaR</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-orange-600">CVaR (95%)</span>
                  <span className="font-bold text-orange-800">{metrics.conditionalVaR95.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-orange-600">CVaR (99%)</span>
                  <span className="font-bold text-orange-800">{metrics.conditionalVaR99.toFixed(2)}%</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-medium text-blue-800 mb-2">Advanced Ratios</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-blue-600">Calmar Ratio</span>
                  <span className="font-bold text-blue-800">{metrics.calmarRatio.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-blue-600">Sortino Ratio</span>
                  <span className="font-bold text-blue-800">{metrics.sortinoRatio.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Downside Risk Metrics */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Downside Risk Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded">
              <p className="text-sm text-gray-600">Ulcer Index</p>
              <p className="text-lg font-bold">{metrics.ulcerIndex.toFixed(2)}</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded">
              <p className="text-sm text-gray-600">Pain Index</p>
              <p className="text-lg font-bold">{metrics.painIndex.toFixed(2)}</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded">
              <p className="text-sm text-gray-600">Martin Ratio</p>
              <p className="text-lg font-bold">{metrics.martinRatio.toFixed(2)}</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded">
              <p className="text-sm text-gray-600">Burke Ratio</p>
              <p className="text-lg font-bold">{metrics.burkeRatio.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Distribution Analysis */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Return Distribution Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-3">Statistical Measures</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Skewness</span>
                  <span className="font-medium">{metrics.skewness.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Kurtosis</span>
                  <span className="font-medium">{metrics.kurtosis.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tail Ratio</span>
                  <span className="font-medium">{metrics.tailRatio.toFixed(3)}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-3">Upside Potential</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Upness Index</span>
                  <span className="font-medium">{(metrics.upnessIndex * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Upside Potential Ratio</span>
                  <span className="font-medium">{metrics.upsidePotentialRatio.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Gain to Pain Ratio</span>
                  <span className="font-medium">{metrics.gainToPainRatio.toFixed(3)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Attribution */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Performance Attribution</h3>
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <PieChart className="w-8 h-8 text-blue-600 mx-auto mb-2" />
            <p className="text-blue-700 font-medium">Factor Analysis</p>
            <p className="text-sm text-blue-600 mt-1">
              Factor decomposition and performance attribution analysis coming in next update
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderReportsTab = () => (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium mb-4">Export Results</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => exportResults('csv')}
            className="flex items-center justify-center p-4 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <Download className="w-5 h-5 mr-2" />
            Export CSV
          </button>
          <button
            onClick={() => exportResults('excel')}
            className="flex items-center justify-center p-4 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <Download className="w-5 h-5 mr-2" />
            Export Excel
          </button>
          <button
            onClick={() => exportResults('pdf')}
            className="flex items-center justify-center p-4 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <Download className="w-5 h-5 mr-2" />
            Export PDF Report
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <Zap className="w-8 h-8 mr-3 text-blue-600" />
          Advanced Backtesting Engine
        </h1>
        <p className="mt-2 text-gray-600">
          Comprehensive strategy testing with advanced risk metrics and performance analysis
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'setup', label: 'Setup', icon: Settings },
              { id: 'data', label: 'Historical Data', icon: Database },
              { id: 'results', label: 'Results', icon: TrendingUp },
              { id: 'analysis', label: 'Analysis', icon: BarChart3 },
              { id: 'reports', label: 'Reports', icon: Download }
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                  activeTab === id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'setup' && renderSetupTab()}
      {activeTab === 'data' && renderDataTab()}
      {activeTab === 'results' && renderResultsTab()}
      {activeTab === 'analysis' && renderAnalysisTab()}
      {activeTab === 'reports' && renderReportsTab()}
    </div>
  );
};

export default Backtesting;