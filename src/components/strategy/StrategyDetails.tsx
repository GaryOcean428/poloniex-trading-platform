import React from 'react';
import { Strategy, StrategyType } from '../../types';
import { BacktestResult } from '../../types/backtest';
import PriceChart from '../charts/PriceChart';
import { useTradingContext } from '../../context/TradingContext';
import { Clock, Zap, BarChart2, History, Sparkles, RefreshCw } from 'lucide-react';

interface StrategyDetailsProps {
  strategy: Strategy;
  backtestResults?: BacktestResult | null;
  isBacktesting?: boolean;
  isOptimizing?: boolean;
}

const StrategyDetails: React.FC<StrategyDetailsProps> = ({ 
  strategy,
  backtestResults,
  isBacktesting,
  isOptimizing
}) => {
  const { marketData } = useTradingContext();
  const [timeframe, setTimeframe] = useState<'1h' | '4h' | '1d'>('1h');
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick');
  
  const getStrategyTypeIcon = (type: StrategyType) => {
    switch (type) {
      case StrategyType.MA_CROSSOVER:
        return <Zap className="h-6 w-6 text-blue-500" />;
      case StrategyType.RSI:
        return <BarChart2 className="h-6 w-6 text-purple-500" />;
      case StrategyType.BREAKOUT:
        return <RefreshCw className="h-6 w-6 text-orange-500" />;
      default:
        return <Zap className="h-6 w-6 text-gray-500" />;
    }
  };
  
  const getStrategyTypeName = (type: StrategyType) => {
    switch (type) {
      case StrategyType.MA_CROSSOVER:
        return 'Moving Average Crossover';
      case StrategyType.RSI:
        return 'Relative Strength Index (RSI)';
      case StrategyType.BREAKOUT:
        return 'Breakout';
      default:
        return type;
    }
  };
  
  const getStrategyDescription = (type: StrategyType) => {
    switch (type) {
      case StrategyType.MA_CROSSOVER:
        return 'This strategy generates signals when the short-term moving average crosses the long-term moving average. A buy signal is generated when the short MA crosses above the long MA, and a sell signal when it crosses below.';
      case StrategyType.RSI:
        return 'The RSI strategy measures the magnitude of recent price changes to evaluate overbought or oversold conditions. It generates buy signals when RSI crosses above the oversold threshold and sell signals when it crosses below the overbought threshold.';
      case StrategyType.BREAKOUT:
        return 'The Breakout strategy identifies significant price movements beyond established support and resistance levels. It generates buy signals when the price breaks above resistance and sell signals when it breaks below support.';
      default:
        return 'Custom trading strategy.';
    }
  };
  
  const renderParameters = () => {
    switch (strategy.type) {
      case StrategyType.MA_CROSSOVER:
        return (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Short Period</div>
              <div className="text-lg font-semibold">{strategy.parameters.shortPeriod}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Long Period</div>
              <div className="text-lg font-semibold">{strategy.parameters.longPeriod}</div>
            </div>
          </div>
        );
      case StrategyType.RSI:
        return (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Period</div>
              <div className="text-lg font-semibold">{strategy.parameters.period}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Overbought</div>
              <div className="text-lg font-semibold">{strategy.parameters.overbought}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Oversold</div>
              <div className="text-lg font-semibold">{strategy.parameters.oversold}</div>
            </div>
          </div>
        );
      case StrategyType.BREAKOUT:
        return (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Lookback Period</div>
              <div className="text-lg font-semibold">{strategy.parameters.lookbackPeriod}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-md">
              <div className="text-sm text-gray-500">Breakout Threshold</div>
              <div className="text-lg font-semibold">{strategy.parameters.breakoutThreshold}%</div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };
  
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center">
          <div className="mr-4">
            {getStrategyTypeIcon(strategy.type)}
          </div>
          <div>
            <h2 className="text-xl font-bold">{strategy.name}</h2>
            <div className="flex items-center text-sm text-gray-500 mt-1">
              <span>{getStrategyTypeName(strategy.type)}</span>
              <span className="mx-2">•</span>
              <span>{strategy.parameters.pair}</span>
              <span className="mx-2">•</span>
              <Clock className="h-4 w-4 mr-1" />
              <span>Created {new Date(strategy.created).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          {isBacktesting && (
            <div className="flex items-center text-blue-600">
              <History className="h-4 w-4 mr-1 animate-spin" />
              <span>Backtesting...</span>
            </div>
          )}
          {isOptimizing && (
            <div className="flex items-center text-purple-600">
              <Sparkles className="h-4 w-4 mr-1 animate-spin" />
              <span>Optimizing...</span>
            </div>
          )}
        </div>
      </div>
      
      <div className="mb-6">
        <div className="text-gray-700 mb-4">{getStrategyDescription(strategy.type)}</div>
        {renderParameters()}
      </div>
      
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Performance</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {strategy.performance && (
            <>
              <div className="bg-gray-50 p-3 rounded-md">
                <div className="text-sm text-gray-500">Total P&L</div>
                <div className={`text-lg font-semibold ${
                  strategy.performance.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {strategy.performance.totalPnL >= 0 ? '+' : ''}
                  {strategy.performance.totalPnL.toFixed(2)}
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded-md">
                <div className="text-sm text-gray-500">Win Rate</div>
                <div className="text-lg font-semibold">
                  {(strategy.performance.winRate * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded-md">
                <div className="text-sm text-gray-500">Total Trades</div>
                <div className="text-lg font-semibold">{strategy.performance.tradesCount}</div>
              </div>
            </>
          )}
        </div>
        
        {backtestResults && (
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium mb-3">Backtest Results</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-600">Initial Balance</div>
                <div className="font-medium">${backtestResults.initialBalance.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Final Balance</div>
                <div className="font-medium">${backtestResults.finalBalance.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Total Trades</div>
                <div className="font-medium">{backtestResults.totalTrades}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Win Rate</div>
                <div className="font-medium">{(backtestResults.winRate * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Max Drawdown</div>
                <div className="font-medium">{(backtestResults.maxDrawdown * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Sharpe Ratio</div>
                <div className="font-medium">{backtestResults.sharpeRatio.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div>
        <h3 className="text-lg font-medium mb-3">Market Data</h3>
        <div className="flex space-x-4 mb-4">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as any)}
            className="px-3 py-1 border border-gray-300 rounded-md"
          >
            <option value="1h">1 Hour</option>
            <option value="4h">4 Hours</option>
            <option value="1d">1 Day</option>
          </select>
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value as any)}
            className="px-3 py-1 border border-gray-300 rounded-md"
          >
            <option value="candlestick">Candlestick</option>
            <option value="line">Line</option>
          </select>
        </div>
        <PriceChart data={marketData} pair={strategy.parameters.pair} />
      </div>
    </div>
  );
};

export default StrategyDetails;