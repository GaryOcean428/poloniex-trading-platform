import React, { useState, useEffect, useCallback } from 'react';
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
} from 'chart.js';
import 'chart.js/auto';
import { Strategy, MarketData, TradingStrategy } from '@/types';
import { optimizeStrategy, backtestStrategy, StrategyTestOptions } from '@/utils/strategyTester';
import { logger } from '@/utils/logger';

// Local type definitions that match the strategy tester utility expectations
interface LocalBacktestTrade {
  id: string;
  entryPrice: number;
  exitPrice: number | null;
  entryTime: string;
  exitTime: string | null;
  side: 'long' | 'short';
  status: 'open' | 'closed' | 'stopped';
  pnl: number;
  pnlPercent: number;
  balance: number;
  size: number;
  fee: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface LocalBacktestResult {
  trades: LocalBacktestTrade[];
  equityCurve: Array<{ time: string; value: number }>;
  metrics: {
    initialBalance: number;
    finalBalance: number;
    netProfit: number;
    netProfitPercent: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    sortinoRatio: number;
    profitLossRatio: number;
    averageTrade: number;
    averageWin: number;
    averageLoss: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
  };
  parameters: Record<string, unknown>;
  startTime: string;
  endTime: string;
  duration: number;
}

interface LocalStrategyOptimizationResult {
  bestParameters: Record<string, unknown>;
  bestResult: LocalBacktestResult;
  optimizationTime: number;
  parameterRanges: Record<string, [number, number, number]>;
  results: Array<{ parameters: Record<string, unknown>; result: LocalBacktestResult }>;
  metrics: Record<string, number>;
  id: string;
  name: string;
  description: string;
  code: string;
}



// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface StrategyTesterProps {
  strategy: Strategy;
  marketData: MarketData[];
  parameterRanges?: Record<string, [number, number, number]>;
  onResultsChange?: (results: LocalBacktestResult) => void;
}

interface LoadingState {
  backtest: boolean;
  optimize: boolean;
  loading: boolean;
}

const StrategyTester: React.FC<StrategyTesterProps> = ({
  strategy,
  marketData,
  parameterRanges = {},
  onResultsChange,
}) => {
  // State
  const [backtestResult, setBacktestResult] = useState<LocalBacktestResult | null>(null);
  const [optimizationResult, setOptimizationResult] = useState<LocalStrategyOptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'backtest' | 'optimization'>('backtest');
  const [isLoading, setIsLoading] = useState<LoadingState>({
    backtest: false,
    optimize: false,
    loading: false,
  });


  // Run backtest
  const runBacktest = useCallback(async (customStrategy?: Strategy): Promise<LocalBacktestResult | undefined> => {
    if (!strategy) return undefined;

    try {
      setIsLoading(prev => ({ ...prev, backtest: true, loading: true }));
      setError(null);

      const strategyToUse = customStrategy || strategy;
      
      // Ensure strategy has all required properties
      const completeStrategy: TradingStrategy = {
        ...strategyToUse,
        active: strategyToUse.active ?? true
      };
      
      const result = await backtestStrategy(completeStrategy, marketData, {
        initialBalance: 10000,
        feePercent: 0.1,
        slippagePercent: 0.1,
        positionSizePercent: 100,
        useStopLoss: false,
        stopLossPercent: 5,
        useTakeProfit: false,
        takeProfitPercent: 10,
        useTrailingStop: false,
        confidenceThreshold: 0.7,
        allowSimultaneousPositions: false,
        maxOpenPositions: 5,
        reinvestProfits: true
      } as unknown as Partial<StrategyTestOptions>);

      if (!result) {
        throw new Error('Backtest returned no results');
      }

      // Map the result to our local BacktestTrade type
      const mappedResult: LocalBacktestResult = {
        trades: (result.trades || []).map((trade: unknown) => {
          const tradeObj = trade as Record<string, unknown>;
          return {
            id: String(tradeObj.id || `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
            entryPrice: Number(tradeObj.entryPrice) || 0,
            exitPrice: tradeObj.exitPrice ? Number(tradeObj.exitPrice) : null,
            entryTime: String(tradeObj.entryTime || new Date().toISOString()),
            exitTime: tradeObj.exitTime ? String(tradeObj.exitTime) : null,
            side: (tradeObj.side as 'long' | 'short') || 'long',
            status: (tradeObj.status as 'open' | 'closed' | 'stopped') || 'closed',
            pnl: Number(tradeObj.pnl) || 0,
            pnlPercent: Number(tradeObj.pnlPercent) || 0,
            balance: Number(tradeObj.balance) || 10000,
            size: Number(tradeObj.size) || 0,
            fee: Number(tradeObj.fee) || 0,
            reason: tradeObj.reason ? String(tradeObj.reason) : undefined,
            metadata: (tradeObj.metadata as Record<string, unknown>) || {}
          };
        }),
        equityCurve: (result.equityCurve as unknown as Array<{ time: string; value: number }>) || [
          { time: new Date().toISOString(), value: 10000 }
        ],
        metrics: {
          initialBalance: (result.metrics as { [key: string]: number })?.initialBalance || 10000,
          finalBalance: (result.metrics as { [key: string]: number })?.finalBalance || 10000,
          netProfit: (result.metrics as { [key: string]: number })?.netProfit || 0,
          netProfitPercent: (result.metrics as { [key: string]: number })?.netProfitPercent || 0,
          totalTrades: (result.metrics as { [key: string]: number })?.totalTrades || 0,
          winningTrades: (result.metrics as { [key: string]: number })?.winningTrades || 0,
          losingTrades: (result.metrics as { [key: string]: number })?.losingTrades || 0,
          winRate: (result.metrics as { [key: string]: number })?.winRate || 0,
          profitFactor: (result.metrics as { [key: string]: number })?.profitFactor || 0,
          maxDrawdown: (result.metrics as { [key: string]: number })?.maxDrawdown || 0,
          maxDrawdownPercent: (result.metrics as { [key: string]: number })?.maxDrawdownPercent || 0,
          sharpeRatio: (result.metrics as { [key: string]: number })?.sharpeRatio || 0,
          sortinoRatio: (result.metrics as { [key: string]: number })?.sortinoRatio || 0,
          profitLossRatio: (result.metrics as { [key: string]: number })?.profitLossRatio || 0,
          averageTrade: (result.metrics as { [key: string]: number })?.averageTrade || 0,
          averageWin: (result.metrics as { [key: string]: number })?.averageWin || 0,
          averageLoss: (result.metrics as { [key: string]: number })?.averageLoss || 0,
          maxConsecutiveWins: (result.metrics as { [key: string]: number })?.maxConsecutiveWins || 0,
          maxConsecutiveLosses: (result.metrics as { [key: string]: number })?.maxConsecutiveLosses || 0
        },
        parameters: (result.parameters as unknown as Record<string, unknown>) || {},
        startTime: String((result as unknown as Record<string, unknown>).startTime) || new Date().toISOString(),
        endTime: String((result as unknown as Record<string, unknown>).endTime) || new Date().toISOString(),
        duration: Number((result as unknown as Record<string, unknown>).duration) || 0
      };

      setBacktestResult(mappedResult);
      onResultsChange?.(mappedResult);
      return mappedResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(`Backtest failed: ${errorMessage}`);
      logger.error(`Backtest error: ${errorMessage}`);
      throw err;
    } finally {
      setIsLoading(prev => ({ ...prev, backtest: false, loading: false }));
    }
  }, [strategy, marketData, onResultsChange]);

  // Run optimization
  const runOptimization = useCallback(async (): Promise<LocalStrategyOptimizationResult | undefined> => {
    if (!strategy) return undefined;

    try {
      setIsLoading(prev => ({ ...prev, optimize: true, loading: true }));
      setError(null);

      // Ensure strategy has all required properties
      const completeStrategy: TradingStrategy = {
        ...strategy,
        active: strategy.active ?? true
      };

      const result = await optimizeStrategy(
        completeStrategy,
        marketData,
        parameterRanges || {},
        'sharpeRatio',
        (strategy.parameters as Record<string, unknown>) || {},
        {
          initialBalance: 10000,
          feePercent: 0.1,
          slippagePercent: 0.1,
          positionSizePercent: 100,
          useStopLoss: false,
          stopLossPercent: 5,
          useTakeProfit: false,
          takeProfitPercent: 10,
          useTrailingStop: false,
          confidenceThreshold: 0.7,
          allowSimultaneousPositions: false,
          maxOpenPositions: 5,
          reinvestProfits: true
        } as Partial<StrategyTestOptions>
      );

      if (!result) {
        throw new Error('Optimization returned no results');
      }

      // Map the best result to our local BacktestTrade type
      const mapBestResult = (bestResult: unknown): LocalBacktestResult | null => {
        if (!bestResult || typeof bestResult !== 'object') return null;
        const result = bestResult as Record<string, unknown>;
        const trades = Array.isArray(result.trades) ? result.trades : [];

        return {
          trades: trades.map((trade: unknown) => {
            const t = trade as Record<string, unknown>;
            return {
              id: String(t.id) || `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              entryPrice: Number(t.entryPrice) || 0,
              exitPrice: t.exitPrice ? Number(t.exitPrice) : null,
              entryTime: String(t.entryTime) || new Date().toISOString(),
              exitTime: t.exitTime ? String(t.exitTime) : null,
              side: t.side === 'short' ? 'short' : 'long',
              status: t.status === 'open' || t.status === 'stopped' ? t.status : 'closed',
              pnl: Number(t.pnl) || 0,
              pnlPercent: Number(t.pnlPercent) || 0,
              balance: Number(t.balance) || 10000,
              size: Number(t.size) || 0,
              fee: Number(t.fee) || 0,
              reason: t.reason ? String(t.reason) : undefined,
              metadata: (t.metadata as Record<string, unknown>) || {}
            };
          }),
          equityCurve: Array.isArray(result.equityCurve) ? result.equityCurve as Array<{time: string, value: number}> : [
            { time: new Date().toISOString(), value: 10000 }
          ],
          metrics: {
            initialBalance: Number((result.metrics as Record<string, unknown>)?.initialBalance) || 0,
            finalBalance: Number((result.metrics as Record<string, unknown>)?.finalBalance) || 0,
            netProfit: Number((result.metrics as Record<string, unknown>)?.netProfit) || 0,
            netProfitPercent: Number((result.metrics as Record<string, unknown>)?.netProfitPercent) || 0,
            totalTrades: Number((result.metrics as Record<string, unknown>)?.totalTrades) || 0,
            winningTrades: Number((result.metrics as Record<string, unknown>)?.winningTrades) || 0,
            losingTrades: Number((result.metrics as Record<string, unknown>)?.losingTrades) || 0,
            winRate: Number((result.metrics as Record<string, unknown>)?.winRate) || 0,
            profitFactor: Number((result.metrics as Record<string, unknown>)?.profitFactor) || 0,
            maxDrawdown: Number((result.metrics as Record<string, unknown>)?.maxDrawdown) || 0,
            maxDrawdownPercent: Number((result.metrics as Record<string, unknown>)?.maxDrawdownPercent) || 0,
            sharpeRatio: Number((result.metrics as Record<string, unknown>)?.sharpeRatio) || 0,
            sortinoRatio: Number((result.metrics as Record<string, unknown>)?.sortinoRatio) || 0,
            profitLossRatio: Number((result.metrics as Record<string, unknown>)?.profitLossRatio) || 0,
            averageTrade: Number((result.metrics as Record<string, unknown>)?.averageTrade) || 0,
            averageWin: Number((result.metrics as Record<string, unknown>)?.averageWin) || 0,
            averageLoss: Number((result.metrics as Record<string, unknown>)?.averageLoss) || 0,
            maxConsecutiveWins: Number((result.metrics as Record<string, unknown>)?.maxConsecutiveWins) || 0,
            maxConsecutiveLosses: Number((result.metrics as Record<string, unknown>)?.maxConsecutiveLosses) || 0
          },
          parameters: (bestResult as unknown as Record<string, unknown>).parameters as Record<string, unknown> || {},
          startTime: String((bestResult as unknown as Record<string, unknown>).startTime) || new Date().toISOString(),
          endTime: String((bestResult as unknown as Record<string, unknown>).endTime) || new Date().toISOString(),
          duration: Number((bestResult as unknown as Record<string, unknown>).duration) || 0
        };
      };

      const mappedResult: LocalStrategyOptimizationResult = {
        bestParameters: (result.bestParameters as unknown as Record<string, unknown>) || {},
        bestResult: (result.bestResult ? mapBestResult(result.bestResult) : null) ?? {
          trades: [],
          equityCurve: [{ time: new Date().toISOString(), value: 10000 }],
          metrics: {
            initialBalance: 10000, finalBalance: 10000, netProfit: 0, netProfitPercent: 0,
            totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
            profitFactor: 0, maxDrawdown: 0, maxDrawdownPercent: 0, sharpeRatio: 0,
            sortinoRatio: 0, profitLossRatio: 0, averageTrade: 0, averageWin: 0,
            averageLoss: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0
          },
          parameters: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 0
        },
        optimizationTime: result.optimizationTime || 0,
        parameterRanges: result.parameterRanges || {},
        results: ((result as unknown as Record<string, unknown>).results as unknown[] || []).map((r: unknown) => {
          const resultItem = r as { parameters: Record<string, unknown>; result: unknown };
          return {
            parameters: resultItem.parameters || {},
            result: mapBestResult(resultItem.result) as LocalBacktestResult
          };
        }) || [],
        metrics: (result as unknown as Record<string, unknown>).metrics as Record<string, number> || {},
        id: strategy.id,
        name: strategy.name,
        description: strategy.name + ' optimization',
        code: 'optimized-strategy'
      };

      setOptimizationResult(mappedResult);
      setBacktestResult(mappedResult.bestResult);
      onResultsChange?.(mappedResult.bestResult);

      logger.info('Optimization completed for strategy: ' + strategy.name + ' in ' + mappedResult.optimizationTime + 'ms');
      return mappedResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(`Optimization failed: ${errorMessage}`);
      logger.error(`Optimization error: ${errorMessage}`);
      throw err;
    } finally {
      setIsLoading(prev => ({ ...prev, optimize: false, loading: false }));
    }
  }, [strategy, marketData, parameterRanges, onResultsChange]);

  // Render backtest results
  const renderBacktestResults = useCallback((): React.ReactElement | null => {
    if (!backtestResult) return null;

    const { metrics, trades } = backtestResult;
    const { 
      initialBalance, 
      finalBalance, 
      netProfit, 
      netProfitPercent, 
      totalTrades, 
      winRate,
      maxDrawdownPercent,
      sharpeRatio,
      sortinoRatio
    } = metrics;

    // Prepare chart data for equity curve
    const chartData = backtestResult.equityCurve.length > 0 ? {
      labels: backtestResult.equityCurve.map(point => new Date(point.time).toLocaleDateString()),
      datasets: [
        {
          label: 'Portfolio Value',
          data: backtestResult.equityCurve.map(point => point.value),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.1
        }
      ]
    } : null;

    // Chart options
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top' as const,
        },
        title: {
          display: true,
          text: 'Equity Curve'
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Date'
          }
        },
        y: {
          display: true,
          title: {
            display: true,
            text: 'Portfolio Value ($)'
          }
        }
      }
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Initial Balance</h4>
            <p className="text-2xl font-semibold">${initialBalance.toFixed(2)}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Final Balance</h4>
            <p className={`text-2xl font-semibold ${finalBalance >= initialBalance ? 'text-green-600' : 'text-red-600'}`}>
              ${finalBalance.toFixed(2)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Net Profit</h4>
            <p className={`text-2xl font-semibold ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)} ({netProfitPercent.toFixed(2)}%)
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Trades</h4>
            <p className="text-2xl font-semibold">{totalTrades}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Win Rate</h4>
            <p className="text-2xl font-semibold">{(winRate * 100).toFixed(2)}%</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Max Drawdown</h4>
            <p className="text-2xl font-semibold text-red-600">{maxDrawdownPercent.toFixed(2)}%</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Sharpe Ratio</h4>
            <p className="text-2xl font-semibold">{sharpeRatio.toFixed(2)}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Sortino Ratio</h4>
            <p className="text-2xl font-semibold">{sortinoRatio.toFixed(2)}</p>
          </div>
        </div>

        {chartData && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="text-lg font-medium mb-4">Equity Curve</h3>
            <div className="h-96">
              <Line data={chartData} options={chartOptions} />
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h3 className="text-lg font-medium mb-4">Recent Trades</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Entry Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Side
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Entry Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Exit Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    P/L
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                {trades.slice(0, 10).map((trade) => (
                  <tr key={trade.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                      {new Date(trade.entryTime).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        trade.side === 'long' 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}>
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                      {trade.entryPrice.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                      {trade.exitPrice ? trade.exitPrice.toFixed(2) : '—'}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                      trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} ({trade.pnlPercent.toFixed(2)}%)
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                      {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }, [backtestResult]);

  // Render optimization results
  const renderOptimizationResults = useCallback((): React.ReactElement | null => {
    if (!optimizationResult) return null;

    const { bestParameters, bestResult, optimizationTime } = optimizationResult;

    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-medium mb-4">Optimization Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Best Parameters</h4>
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                {Object.entries(bestParameters).map(([key, value]) => (
                  <div key={key} className="flex justify-between py-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {key}:
                    </span>
                    <span className="text-sm text-gray-900 dark:text-white">
                      {typeof value === 'number' ? value.toFixed(4) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Performance</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Net Profit</div>
                  <div className={`text-xl font-semibold ${
                    (bestResult.metrics.netProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {bestResult.metrics.netProfit?.toFixed(2)} ({bestResult.metrics.netProfitPercent?.toFixed(2)}%)
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Win Rate</div>
                  <div className="text-xl font-semibold">
                    {((bestResult.metrics.winRate ?? 0) * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Sharpe Ratio</div>
                  <div className="text-xl font-semibold">
                    {bestResult.metrics.sharpeRatio?.toFixed(2) || 'N/A'}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Max Drawdown</div>
                  <div className="text-xl font-semibold text-red-600">
                    {bestResult.metrics.maxDrawdownPercent?.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Optimization Details</h4>
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Optimization Time</div>
                  <div className="text-sm">
                    {optimizationTime ? `${(optimizationTime / 1000).toFixed(2)} seconds` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Tests</div>
                  <div className="text-sm">
                    {optimizationResult.results?.length || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-medium mb-4">Best Strategy Performance</h3>
          {backtestResult && renderBacktestResults()}
        </div>
      </div>
    );
  }, [optimizationResult, backtestResult, renderBacktestResults]);

  // Handle tab change
  const handleTabChange = useCallback((tab: 'backtest' | 'optimization') => {
    setActiveTab(tab);
  }, []);

  // Handle run backtest click
  const handleRunBacktest = useCallback(async () => {
    try {
      await runBacktest();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to run backtest';
      setError(errorMessage);
      logger.error(`Backtest error: ${errorMessage}`);
    }
  }, [runBacktest]);

  // Handle run optimization click
  const handleRunOptimization = useCallback(async () => {
    try {
      await runOptimization();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to run optimization';
      setError(errorMessage);
      logger.error(`Optimization error: ${errorMessage}`);
    }
  }, [runOptimization]);

  // Run initial backtest when component mounts
  useEffect(() => {
    if (strategy) {
      handleRunBacktest().catch(() => {
        logger.info('Starting backtest for strategy: ' + strategy.name);
      });
    }
  }, [strategy, handleRunBacktest]);

  return (
    <div className="p-4">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="mb-4">
        <button
          onClick={handleRunBacktest}
          disabled={isLoading.backtest || isLoading.loading}
          className={`px-4 py-2 rounded mr-2 ${isLoading.backtest || isLoading.loading ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
        >
          {isLoading.backtest ? 'Running...' : 'Run Backtest'}
        </button>

        <button
          onClick={handleRunOptimization}
          disabled={isLoading.optimize || isLoading.loading}
          className={`px-4 py-2 rounded ${isLoading.optimize || isLoading.loading ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600 text-white'}`}
        >
          {isLoading.optimize ? 'Optimizing...' : 'Optimize Strategy'}
        </button>
      </div>

      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => handleTabChange('backtest')}
            className={`${activeTab === 'backtest' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Backtest Results
          </button>
          <button
            onClick={() => handleTabChange('optimization')}
            className={`${activeTab === 'optimization' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Optimization Results
          </button>
        </nav>
      </div>

      <div className="mt-4">
        {isLoading.loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : activeTab === 'backtest' ? (
          backtestResult ? (
            <div className="space-y-6">
              {renderBacktestResults()}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No backtest results available. Click "Run Backtest" to get started.</p>
            </div>
          )
        ) : optimizationResult ? (
          renderOptimizationResults()
        ) : (
          <div className="text-center py-12 text-gray-500">
            <p>No optimization results available. Click "Optimize Strategy" to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategyTester;
