import React, { useState, useEffect, useCallback } from 'react';
import { Strategy, MarketData } from '@/types';
import { 
  backtestStrategy, 
  optimizeStrategy, 
  monteCarloSimulation, 
  walkForwardAnalysis,
  BacktestResult,
  StrategyTestOptions,
  StrategyOptimizationResult
} from '@/utils/strategyTester';
import { Line } from 'react-chartjs-2';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
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
  Title,
  Tooltip,
  Legend,
  Filler
);

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
  const [monteCarloResult, setMonteCarloResult] = useState<any | null>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<any | null>(null);
  
  // State for active tab
  const [activeTab, setActiveTab] = useState<'backtest' | 'optimize' | 'monteCarlo' | 'walkForward'>('backtest');
  
  // State for loading indicators
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({
    backtest: false,
    optimize: false,
    monteCarlo: false,
    walkForward: false
  });

  // Run backtest when options change
  useEffect(() => {
    runBacktest();
  }, [runBacktest]);

  // Notify parent component when results change
  useEffect(() => {
    if (backtestResult && onResultsChange) {
      onResultsChange(backtestResult);
    }
  }, [backtestResult, onResultsChange]);

  // Run backtest
  const runBacktest = useCallback(async () => {
    if (!marketData.length) return;
    
    setIsLoading(prev => ({ ...prev, backtest: true }));
    
    try {
      // Use setTimeout to allow UI to update before running the backtest
      setTimeout(() => {
        const result = backtestStrategy(strategy, marketData, testOptions);
        setBacktestResult(result);
        setIsLoading(prev => ({ ...prev, backtest: false }));
      }, 50);
    } catch (error) {
      console.error('Backtest error:', error);
      setIsLoading(prev => ({ ...prev, backtest: false }));
    }
  }, [strategy, marketData, testOptions]);

  // Run optimization
  const runOptimization = async (metric: string = 'netProfit') => {
    if (!marketData.length || Object.keys(parameterRanges).length === 0) return;
    
    setIsLoading(prev => ({ ...prev, optimize: true }));
    
    try {
      // Use setTimeout to allow UI to update before running the optimization
      setTimeout(() => {
        const result = optimizeStrategy(
          strategy.type,
          marketData,
          parameterRanges,
          metric as any,
          strategy.parameters,
          testOptions
        );
        setOptimizationResult(result);
        setIsLoading(prev => ({ ...prev, optimize: false }));
      }, 50);
    } catch (error) {
      console.error('Optimization error:', error);
      setIsLoading(prev => ({ ...prev, optimize: false }));
    }
  };

  // Run Monte Carlo simulation
  const runMonteCarloSimulation = async (numSimulations: number = 1000) => {
    if (!backtestResult) return;
    
    setIsLoading(prev => ({ ...prev, monteCarlo: true }));
    
    try {
      // Use setTimeout to allow UI to update before running the simulation
      setTimeout(() => {
        const result = monteCarloSimulation(backtestResult, numSimulations);
        setMonteCarloResult(result);
        setIsLoading(prev => ({ ...prev, monteCarlo: false }));
      }, 50);
    } catch (error) {
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
    
    try {
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
    } catch (error) {
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

  // Prepare optimization heatmap data
  const prepareHeatmapData = () => {
    if (!optimizationResult) return null;
    
    // Implementation depends on the charting library used
    // This is a placeholder for the heatmap data preparation
    return optimizationResult.parameterHeatmap;
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
    
    for (let i = min; i <= max; i += binSize) {
      bins.push(i);
      counts.push(0);
    }
    
    for (const value of equityDistribution) {
      const binIndex = Math.floor((value - min) / binSize);
      if (binIndex >= 0 && binIndex < counts.length) {
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
      losingTrades,
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
                    <td className="py-1 text-right font-medium">{value}</td>
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
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        trade.type === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
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
    if (!optimizationResult) {
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
                      <td className="py-1 text-right font-medium">{value}</td>
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
                  <td className="py-1 text-right font-medium">{bestParameters[key]}</td>
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

  // Render Monte Carlo simulation results
  const renderMonteCarloResults = () => {
    if (!monteCarloResult) {
      return (
        <div className="bg-white p-6 rounded-lg shadow text-center">
          <p className="text-neutral-600 mb-4">
            Run Monte Carlo simulation to assess strategy robustness.
          </p>
          <button
            onClick={() => runMonteCarloSimulation()}
            disabled={!backtestResult || isLoading.monteCarlo}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading.monteCarlo ? 'Simulating...' : 'Run Monte Carlo Simulation'}
          </button>
        </div>
      );
    }
    
    const { confidenceIntervals, worstCase, bestCase, medianCase } = monteCarloResult;
    const monteCarloChartData = prepareMonteCarloData();
    
    return (
      <div className="space-y-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Monte Carlo Simulation Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-neutral-50 p-3 rounded">
              <h4 className="text-sm font-medium text-neutral-500 mb-2">95% Confidence Interval</h4>
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 text-neutral-600">Final Balance</td>
                    <td className="py-1 text-right font-medium">
                      ${confidenceIntervals.finalBalance[0].toFixed(2)} to ${confidenceIntervals.finalBalance[1].toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Max Drawdown</td>
                    <td className="py-1 text-right font-medium">
                      {confidenceIntervals.maxDrawdownPercent[0].toFixed(2)}% to {confidenceIntervals.maxDrawdownPercent[1].toFixed(2)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Win Rate</td>
                    <td className="py-1 text-right font-medium">
                      {confidenceIntervals.winRate[0].toFixed(2)}% to {confidenceIntervals.winRate[1].toFixed(2)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Profit Factor</td>
                    <td className="py-1 text-right font-medium">
                      {confidenceIntervals.profitFactor[0].toFixed(2)} to {confidenceIntervals.profitFactor[1].toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div className="bg-neutral-50 p-3 rounded">
              <h4 className="text-sm font-medium text-neutral-500 mb-2">Worst Case Scenario</h4>
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 text-neutral-600">Final Balance</td>
                    <td className="py-1 text-right font-medium">${worstCase.finalBalance.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Max Drawdown</td>
                    <td className="py-1 text-right font-medium">{worstCase.maxDrawdownPercent.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Win Rate</td>
                    <td className="py-1 text-right font-medium">{worstCase.winRate.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Profit Factor</td>
                    <td className="py-1 text-right font-medium">{worstCase.profitFactor.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div className="bg-neutral-50 p-3 rounded">
              <h4 className="text-sm font-medium text-neutral-500 mb-2">Best Case Scenario</h4>
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 text-neutral-600">Final Balance</td>
                    <td className="py-1 text-right font-medium">${bestCase.finalBalance.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Max Drawdown</td>
                    <td className="py-1 text-right font-medium">{bestCase.maxDrawdownPercent.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Win Rate</td>
                    <td className="py-1 text-right font-medium">{bestCase.winRate.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Profit Factor</td>
                    <td className="py-1 text-right font-medium">{bestCase.profitFactor.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Final Equity Distribution</h3>
          {monteCarloChartData && (
            <div className="h-64">
              <Line 
                data={monteCarloChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    y: {
                      beginAtZero: true
                    }
                  },
                  plugins: {
                    legend: {
                      display: false
                    }
                  }
                }}
              />
            </div>
          )}
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={() => runMonteCarloSimulation()}
            disabled={!backtestResult || isLoading.monteCarlo}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading.monteCarlo ? 'Simulating...' : 'Run Again'}
          </button>
        </div>
      </div>
    );
  };

  // Render walk-forward analysis results
  const renderWalkForwardResults = () => {
    if (!walkForwardResult) {
      return (
        <div className="bg-white p-6 rounded-lg shadow text-center">
          <p className="text-neutral-600 mb-4">
            Run walk-forward analysis to test strategy robustness across different time periods.
          </p>
          <button
            onClick={() => runWalkForwardAnalysis()}
            disabled={!marketData.length || isLoading.walkForward}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading.walkForward ? 'Analyzing...' : 'Run Walk-Forward Analysis'}
          </button>
        </div>
      );
    }
    
    const { foldResults, aggregateResult } = walkForwardResult;
    
    return (
      <div className="space-y-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-4">Walk-Forward Analysis Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <h4 className="text-md font-medium mb-2">In-Sample vs Out-of-Sample Performance</h4>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left py-2">Metric</th>
                    <th className="text-right py-2">In-Sample</th>
                    <th className="text-right py-2">Out-of-Sample</th>
                    <th className="text-right py-2">Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 text-neutral-600">Net Profit</td>
                    <td className="py-1 text-right">${aggregateResult.inSampleMetrics.netProfit.toFixed(2)}</td>
                    <td className="py-1 text-right">${aggregateResult.outOfSampleMetrics.netProfit.toFixed(2)}</td>
                    <td className="py-1 text-right font-medium">
                      {(aggregateResult.outOfSampleMetrics.netProfit / aggregateResult.inSampleMetrics.netProfit).toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Win Rate</td>
                    <td className="py-1 text-right">{aggregateResult.inSampleMetrics.winRate.toFixed(2)}%</td>
                    <td className="py-1 text-right">{aggregateResult.outOfSampleMetrics.winRate.toFixed(2)}%</td>
                    <td className="py-1 text-right font-medium">
                      {(aggregateResult.outOfSampleMetrics.winRate / aggregateResult.inSampleMetrics.winRate).toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Profit Factor</td>
                    <td className="py-1 text-right">{aggregateResult.inSampleMetrics.profitFactor.toFixed(2)}</td>
                    <td className="py-1 text-right">{aggregateResult.outOfSampleMetrics.profitFactor.toFixed(2)}</td>
                    <td className="py-1 text-right font-medium">
                      {(aggregateResult.outOfSampleMetrics.profitFactor / aggregateResult.inSampleMetrics.profitFactor).toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-neutral-600">Max Drawdown</td>
                    <td className="py-1 text-right">{aggregateResult.inSampleMetrics.maxDrawdownPercent.toFixed(2)}%</td>
                    <td className="py-1 text-right">{aggregateResult.outOfSampleMetrics.maxDrawdownPercent.toFixed(2)}%</td>
                    <td className="py-1 text-right font-medium">
                      {(aggregateResult.outOfSampleMetrics.maxDrawdownPercent / aggregateResult.inSampleMetrics.maxDrawdownPercent).toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div>
              <h4 className="text-md font-medium mb-2">Robustness Score</h4>
              <div className="bg-neutral-50 p-4 rounded">
                <div className="text-center">
                  <span className="text-3xl font-bold">
                    {aggregateResult.robustnessScore.toFixed(2)}
                  </span>
                  <p className="text-sm text-neutral-600 mt-1">
                    {aggregateResult.robustnessScore >= 0.7 
                      ? 'Good robustness (>= 0.7)' 
                      : aggregateResult.robustnessScore >= 0.5 
                        ? 'Moderate robustness (>= 0.5)' 
                        : 'Poor robustness (< 0.5)'}
                  </p>
                </div>
                <p className="text-xs text-neutral-500 mt-4">
                  A score close to 1.0 indicates that the strategy performs similarly on unseen data as it does on training data, suggesting good robustness.
                </p>
              </div>
            </div>
          </div>
          
          <h4 className="text-md font-medium mb-2">Fold Results</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Fold</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">In-Sample Profit</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Out-of-Sample Profit</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">In-Sample Win Rate</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Out-of-Sample Win Rate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {foldResults.map((fold, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-neutral-500">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      <span className={fold.inSample.metrics.netProfit > 0 ? 'text-green-600' : 'text-red-600'}>
                        ${fold.inSample.metrics.netProfit.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      <span className={fold.outOfSample.metrics.netProfit > 0 ? 'text-green-600' : 'text-red-600'}>
                        ${fold.outOfSample.metrics.netProfit.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-neutral-500">
                      {fold.inSample.winRate.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-neutral-500">
                      {fold.outOfSample.winRate.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={() => runWalkForwardAnalysis()}
            disabled={!marketData.length || isLoading.walkForward}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading.walkForward ? 'Analyzing...' : 'Run Again'}
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
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="useStopLoss"
                checked={testOptions.useStopLoss}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  useStopLoss: e.target.checked
                })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
              />
              <label htmlFor="useStopLoss" className="ml-2 block text-sm text-neutral-700">
                Use Stop Loss
              </label>
              {testOptions.useStopLoss && (
                <input
                  type="number"
                  value={testOptions.stopLossPercent}
                  onChange={(e) => setTestOptions({
                    ...testOptions,
                    stopLossPercent: parseFloat(e.target.value)
                  })}
                  className="ml-2 w-16 p-1 border border-neutral-300 rounded-md"
                />
              )}
              <span className="ml-1 text-sm text-neutral-500">%</span>
            </div>
            
            <div className="flex items-center">
              <input
                type="checkbox"
                id="useTakeProfit"
                checked={testOptions.useTakeProfit}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  useTakeProfit: e.target.checked
                })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
              />
              <label htmlFor="useTakeProfit" className="ml-2 block text-sm text-neutral-700">
                Use Take Profit
              </label>
              {testOptions.useTakeProfit && (
                <input
                  type="number"
                  value={testOptions.takeProfitPercent}
                  onChange={(e) => setTestOptions({
                    ...testOptions,
                    takeProfitPercent: parseFloat(e.target.value)
                  })}
                  className="ml-2 w-16 p-1 border border-neutral-300 rounded-md"
                />
              )}
              <span className="ml-1 text-sm text-neutral-500">%</span>
            </div>
            
            <div className="flex items-center">
              <input
                type="checkbox"
                id="useTrailingStop"
                checked={testOptions.useTrailingStop}
                onChange={(e) => setTestOptions({
                  ...testOptions,
                  useTrailingStop: e.target.checked
                })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
              />
              <label htmlFor="useTrailingStop" className="ml-2 block text-sm text-neutral-700">
                Use Trailing Stop
              </label>
              {testOptions.useTrailingStop && (
                <input
                  type="number"
                  value={testOptions.trailingStopPercent}
                  onChange={(e) => setTestOptions({
                    ...testOptions,
                    trailingStopPercent: parseFloat(e.target.value)
                  })}
                  className="ml-2 w-16 p-1 border border-neutral-300 rounded-md"
                />
              )}
              <span className="ml-1 text-sm text-neutral-500">%</span>
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
              className={`py-2 px-4 text-sm font-medium ${
                activeTab === 'backtest'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              Backtest Results
            </button>
            <button
              onClick={() => setActiveTab('optimize')}
              className={`py-2 px-4 text-sm font-medium ${
                activeTab === 'optimize'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              Optimization
            </button>
            <button
              onClick={() => setActiveTab('monteCarlo')}
              className={`py-2 px-4 text-sm font-medium ${
                activeTab === 'monteCarlo'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              Monte Carlo
            </button>
            <button
              onClick={() => setActiveTab('walkForward')}
              className={`py-2 px-4 text-sm font-medium ${
                activeTab === 'walkForward'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              Walk-Forward
            </button>
          </nav>
        </div>
      </div>
      
      <div>
        {activeTab === 'backtest' && renderBacktestResults()}
        {activeTab === 'optimize' && renderOptimizationResults()}
        {activeTab === 'monteCarlo' && renderMonteCarloResults()}
        {activeTab === 'walkForward' && renderWalkForwardResults()}
      </div>
    </div>
  );
};

export default StrategyTester;
