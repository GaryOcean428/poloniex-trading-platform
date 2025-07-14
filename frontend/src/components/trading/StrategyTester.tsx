import { MarketData, Strategy } from '@/types';
import {
  BacktestResult,
  StrategyOptimizationResult,
  StrategyTestOptions,
  backtestStrategy,
  monteCarloSimulation,
  optimizeStrategy,
  walkForwardAnalysis
} from '@/utils/strategyTester';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip
} from 'chart.js';
import React, { useCallback, useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface MonteCarloResult {
  confidenceIntervals: Record<string, [number, number]>;
  worstCase: Record<string, number>;
  bestCase: Record<string, number>;
  distributions: Record<string, number[]>;
}

interface WalkForwardResult {
  foldResults: Array<{
    inSample: BacktestResult;
    outOfSample: BacktestResult;
  }>;
  aggregateResult: {
    inSampleMetrics: Record<string, number>;
    outOfSampleMetrics: Record<string, number>;
    robustnessScore: number;
  };
}

interface StrategyTesterProps {
  strategy: Strategy;
  marketData: MarketData[];
  initialOptions?: Partial<StrategyTestOptions>;
  parameterRanges?: Record<string, [number, number, number]>;
  onResultsChange?: (results: BacktestResult) => void;
}

const StrategyTester: React.FC<StrategyTesterProps> = ({
  strategy,
  marketData,
  initialOptions = {},
  parameterRanges = {},
  onResultsChange
}) => {
  // State for test options
  const [testOptions, setTestOptions] = useState<StrategyTestOptions>({
    initialBalance: 10000,
    feePercent: 0.1,
    slippagePercent: 0.05,
    positionSizePercent: 10,
    useStopLoss: false,
    stopLossPercent: 5,
    useTakeProfit: false,
    takeProfitPercent: 10,
    useTrailingStop: false,
    trailingStopPercent: 2,
    confidenceThreshold: 0.5,
    allowSimultaneousPositions: false,
    maxOpenPositions: 1,
    reinvestProfits: true,
    ...initialOptions
  });

  // State for test results
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [optimizationResult, setOptimizationResult] = useState<StrategyOptimizationResult | null>(null);
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<WalkForwardResult | null>(null);

  // State for active tab
  const [activeTab, setActiveTab] = useState<'backtest' | 'optimize' | 'monteCarlo' | 'walkForward'>('backtest');

  // State for loading indicators
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({
    backtest: false,
    optimize: false,
    monteCarlo: false,
    walkForward: false
  });

  // Run backtest
  const runBacktest = useCallback(async () => {
    if (!marketData.length) return;

    setIsLoading(prev => ({ ...prev, backtest: true }));

    try
    {
      // Use setTimeout to allow UI to update before running the backtest
      setTimeout(() => {
        const result = backtestStrategy(strategy, marketData, testOptions);
        setBacktestResult(result);
        setIsLoading(prev => ({ ...prev, backtest: false }));
      }, 50);
    } catch (error)
    {
      console.error('Backtest error:', error);
      setIsLoading(prev => ({ ...prev, backtest: false }));
    }
  }, [strategy, marketData, testOptions]);

  // Run backtest when options change
  useEffect(() => {
    runBacktest();
  }, [runBacktest]);

  // Notify parent component when results change
  useEffect(() => {
    if (backtestResult && onResultsChange)
    {
      onResultsChange(backtestResult);
    }
  }, [backtestResult, onResultsChange]);

  // Run optimization
  const runOptimization = async (metric: string = 'netProfit') => {
    if (!marketData.length || Object.keys(parameterRanges).length === 0) return;

    setIsLoading(prev => ({ ...prev, optimize: true }));

    try
    {
      // Use setTimeout to allow UI to update before running the optimization
      setTimeout(() => {
        const result = optimizeStrategy(
          strategy.type,
          marketData,
          parameterRanges,
          metric as 'netProfit' | 'winRate' | 'profitFactor' | 'sharpeRatio',
          strategy.parameters,
          testOptions
        );
        setOptimizationResult(result);
        setIsLoading(prev => ({ ...prev, optimize: false }));
      }, 50);
    } catch (error)
    {
      console.error('Optimization error:', error);
      setIsLoading(prev => ({ ...prev, optimize: false }));
    }
  };

  // Run Monte Carlo simulation
  const runMonteCarloSimulation = async (numSimulations: number = 1000) => {
    if (!backtestResult) return;

    setIsLoading(prev => ({ ...prev, monteCarlo: true }));

    try
    {
      // Use setTimeout to allow UI to update before running the simulation
      setTimeout(() => {
        const result = monteCarloSimulation(backtestResult, numSimulations);
        setMonteCarloResult(result);
        setIsLoading(prev => ({ ...prev, monteCarlo: false }));
      }, 50);
    } catch (error)
    {
      console.error('Monte Carlo simulation error:', error);
      setIsLoading(prev => ({ ...prev, monteCarlo: false }));
    }
  };

  // Run walk-forward analysis
  const runWalkForwardAnalysis = async (
    inSamplePercent: number = 70,
    numFolds: number = 5
  ) => {
    if (!marketData.length) return;

    setIsLoading(prev => ({ ...prev, walkForward: true }));

    try
    {
      // Use setTimeout to allow UI to update before running the analysis
      setTimeout(() => {
        const result = walkForwardAnalysis(
          strategy,
          marketData,
          {
            inSamplePercent,
            numFolds,
            optimizationMetric: 'netProfit',
            parameterRanges,
            testOptions
          }
        );
        setWalkForwardResult(result);
        setIsLoading(prev => ({ ...prev, walkForward: false }));
      }, 50);
    } catch (error)
    {
      console.error('Walk-forward analysis error:', error);
      setIsLoading(prev => ({ ...prev, walkForward: false }));
    }
  };

  // Prepare equity curve chart data
  const prepareEquityCurveData = () => {
    if (!backtestResult) return null;

    const labels = backtestResult.equityCurve.map(point =>
      new Date(point.date).toLocaleDateString()
    );

    const equityData = backtestResult.equityCurve.map(point => point.equity);
    const drawdownData = backtestResult.equityCurve.map(point => point.drawdownPercent);

    return {
      labels,
      datasets: [
        {
          label: 'Equity',
          data: equityData,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.1)',
          tension: 0.1,
          fill: false
        },
        {
          label: 'Drawdown %',
          data: drawdownData,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.1)',
          tension: 0.1,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    };
  };

  // Prepare Monte Carlo simulation chart data
  const prepareMonteCarloData = () => {
    if (!monteCarloResult) return null;

    const equityDistribution = monteCarloResult.distributions.finalBalance;
    const sortedEquity = [...equityDistribution].sort((a, b) => a - b);

    // Create histogram data
    const min = Math.floor(sortedEquity[0]);
    const max = Math.ceil(sortedEquity[sortedEquity.length - 1]);
    const binSize = Math.ceil((max - min) / 20); // 20 bins

    const bins: number[] = [];
    const counts: number[] = [];

    for (let i = min; i <= max; i += binSize)
    {
      bins.push(i);
      counts.push(0);
    }

    for (const value of equityDistribution)
    {
      const binIndex = Math.floor((value - min) / binSize);
      if (binIndex >= 0 && binIndex < counts.length)
      {
        counts[binIndex]++;
      }
    }

    return {
      labels: bins.map(bin => bin.toFixed(0)),
      datasets: [
        {
          label: 'Final Equity Distribution',
          data: counts,
          backgroundColor: 'rgba(75, 192, 192, 0.6)',
          borderColor: 'rgb(75, 192, 192)',
          borderWidth: 1
        }
      ]
    };
  };

  // Render backtest results
  const renderBacktestResults = () => {
    if (!backtestResult) return null;

    const {
      initialBalance,
      finalBalance,
      totalTrades,
      winningTrades,
      winRate,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercent,
      sharpeRatio,
      metrics
    } = backtestResult;

    const equityCurveData = prepareEquityCurveData();

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-neutral-500">Profit/Loss</h3>
            <p className={`text-2xl font-bold ${finalBalance > initialBalance ? 'text-green-600' : 'text-red-600'}`}>
              ${(finalBalance - initialBalance).toFixed(2)}
            </p>
            <p className="text-sm text-neutral-500">
              {((finalBalance - initialBalance) / initialBalance * 100).toFixed(2)}%
            </p>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-neutral-500">Win Rate</h3>
            <p className="text-2xl font-bold">{winRate.toFixed(2)}%</p>
            <p className="text-sm text-neutral-500">
              {winningTrades} / {totalTrades} trades
            </p>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-neutral-500">Profit Factor</h3>
            <p className="text-2xl font-bold">{profitFactor.toFixed(2)}</p>
            <p className="text-sm text-neutral-500">
              Wins / Losses ratio
            </p>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-neutral-500">Max Drawdown</h3>
            <p className="text-2xl font-bold text-red-600">{maxDrawdownPercent.toFixed(2)}%</p>
            <p className="text-sm text-neutral-500">
              ${maxDrawdown.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Equity Curve</h3>
          {equityCurveData && (
            <div className="h-64">
              <Line
                data={equityCurveData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: {
                      ticks: {
                        maxTicksLimit: 10
                      }
                    },
                    y: {
                      beginAtZero: false
                    },
                    y1: {
                      position: 'right',
                      beginAtZero: true,
                      max: 100,
                      reverse: true,
                      grid: {
                        drawOnChartArea: false
                      }
                    }
                  }
                }}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-lg font-medium mb-4">Performance Metrics</h3>
            <table className="w-full">
              <tbody>
                <tr>
                  <td className="py-1 text-neutral-600">Sharpe Ratio</td>
                  <td className="py-1 text-right font-medium">{sharpeRatio.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-neutral-600">Annualized Return</td>
                  <td className="py-1 text-right font-medium">{(metrics.annualizedReturn * 100).toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1 text-neutral-600">Average Trade</td>
                  <td className="py-1 text-right font-medium">${metrics.averageTrade.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-neutral-600">Average Win</td>
                  <td className="py-1 text-right font-medium">${metrics.averageProfit.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-neutral-600">Average Loss</td>
                  <td className="py-1 text-right font-medium">${metrics.averageLoss.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-lg font-medium mb-4">Strategy Parameters</h3>
            <table className="w-full">
              <tbody>
                {Object.entries(strategy.parameters).map(([key, value]) => (
                  <tr key={key}>
                    <td className="py-1 text-neutral-600">{key}</td>
                    <td className="py-1 text-right font-medium">{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Recent Trades</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Entry Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Exit Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Profit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Reason</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {backtestResult.trades.slice(-10).reverse().map((trade, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                      {new Date(trade.entryDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${trade.type === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {trade.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                      ${trade.entryPrice.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                      ${trade.exitPrice ? trade.exitPrice.toFixed(2) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={trade.profit > 0 ? 'text-green-600' : 'text-red-600'}>
                        ${trade.profit.toFixed(2)} ({trade.profitPercent.toFixed(2)}%)
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                      {trade.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // Render optimization results
  const renderOptimizationResults = () => {
    if (!optimizationResult)
    {
      return (
        <div className="bg-white p-6 rounded-lg shadow text-center">
          <p className="text-neutral-600 mb-4">
            Run parameter optimization to find the best strategy parameters.
          </p>
          <button
            onClick={() => runOptimization()}
            disabled={isLoading.optimize}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading.optimize ? 'Optimizing...' : 'Run Optimization'}
          </button>
        </div>
      );
    }

    const { bestParameters, bestResult, optimizationTime, parameterRanges } = optimizationResult;

    return (
      <div className="space-y-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Optimization Results</h3>
          <p className="text-sm text-neutral-600 mb-2">
            Completed in {(optimizationTime / 1000).toFixed(2)} seconds
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <h4 className="text-md font-medium mb-2">Best Parameters</h4>
              <table className="w-full">
                <tbody>
                  {Object.entries(bestParameters).map(([key, value]) => (
                    <tr key={key}>
                      <td className="py-1 text-neutral-600">{key}</td>
                      <td className="py-1 text-right font-medium">{String(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="text-md font-medium mb-2">Performance</h4>
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 text-neutral-600">Net Profit</td>
                    <td className="py-1 text-right font-medium">${bestResult.metrics.netProfit.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Win Rate</td>
                    <td className="py-1 text-right font-medium">{bestResult.winRate.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Profit Factor</td>
                    <td className="py-1 text-right font-medium">{bestResult.profitFactor.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Max Drawdown</td>
                    <td className="py-1 text-right font-medium">{bestResult.maxDrawdownPercent.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Sharpe Ratio</td>
                    <td className="py-1 text-right font-medium">{bestResult.sharpeRatio.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Parameter Ranges</h3>
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left py-2">Parameter</th>
                <th className="text-right py-2">Min</th>
                <th className="text-right py-2">Max</th>
                <th className="text-right py-2">Step</th>
                <th className="text-right py-2">Best Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(parameterRanges).map(([key, [min, max, step]]) => (
                <tr key={key}>
                  <td className="py-1 text-neutral-600">{key}</td>
                  <td className="py-1 text-right">{min}</td>
                  <td className="py-1 text-right">{max}</td>
                  <td className="py-1 text-right">{step}</td>
                  <td className="py-1 text-right font-medium">{String(bestParameters[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end space-x-2">
          <button
            onClick={() => {
              // Apply optimized parameters to strategy
              const updatedStrategy = {
                ...strategy,
                parameters: bestParameters
              };
              // Run backtest with optimized parameters
              backtestStrategy(updatedStrategy, marketData, testOptions);
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Apply Optimized Parameters
          </button>

          <button
            onClick={() => runOptimization()}
            disabled={isLoading.optimize}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading.optimize ? 'Optimizing...' : 'Run Again'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-neutral-100 p-4 rounded-lg">
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">Strategy Tester</h2>

        <div className="bg-white p-4 rounded-lg shadow mb-4">
          <h3 className="text-lg font-medium mb-4">Test Options</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Initial Balance
              </label>
              <input
                type="number"
                value={testOptions.initialBalance}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  initialBalance: parseFloat(e.target.value)
                })}
                className="w-full p-2 border border-neutral-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Position Size (%)
              </label>
              <input
                type="number"
                value={testOptions.positionSizePercent}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  positionSizePercent: parseFloat(e.target.value)
                })}
                className="w-full p-2 border border-neutral-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Fee (%)
              </label>
              <input
                type="number"
                value={testOptions.feePercent}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  feePercent: parseFloat(e.target.value)
                })}
                className="w-full p-2 border border-neutral-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Slippage (%)
              </label>
              <input
                type="number"
                value={testOptions.slippagePercent}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  slippagePercent: parseFloat(e.target.value)
                })}
                className="w-full p-2 border border-neutral-300 rounded-md"
              />
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={runBacktest}
              disabled={isLoading.backtest}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isLoading.backtest ? 'Running...' : 'Run Backtest'}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="border-b border-neutral-200">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveTab('backtest')}
              className={`py-2 px-4 text-sm font-medium ${activeTab === 'backtest'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
            >
              Backtest Results
            </button>
            <button
              onClick={() => setActiveTab('optimize')}
              className={`py-2 px-4 text-sm font-medium ${activeTab === 'optimize'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
            >
              Optimization
            </button>
          </nav>
        </div>
      </div>

      <div>
        {activeTab === 'backtest' && renderBacktestResults()}
        {activeTab === 'optimize' && renderOptimizationResults()}
      </div>
    </div>
  );
};

export default StrategyTester;
