import React, { useEffect, useState } from 'react';
import { useTradingContext } from '../../hooks/useTradingContext';
import { useWebSocket } from '../../services/websocketService';
import { TickerService, type TickerData } from '../../services/tickerService';

const RealTimeMarketTicker: React.FC = () => {
  const { isConnected, isMockMode } = useWebSocket();
  const { isMockMode: contextMockMode } = useTradingContext();
  const [tickerData, setTickerData] = useState<TickerData[]>([]);
  const [selectedPairs] = useState(['BTC-USDT', 'ETH-USDT', 'ADA-USDT', 'DOT-USDT']);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch real ticker data from backend
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const initializeTickers = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Subscribe to ticker updates (polls every 2 seconds)
        cleanup = TickerService.subscribeTickers(
          selectedPairs,
          (tickers) => {
            if (tickers.length > 0) {
              setTickerData(tickers);
              setIsLoading(false);
            } else {
              setError('No ticker data available');
              setIsLoading(false);
            }
          },
          2000 // Update every 2 seconds
        );
      } catch (err) {
        console.error('Failed to initialize tickers:', err);
        setError('Failed to load market data');
        setIsLoading(false);
      }
    };

    initializeTickers();

    // Cleanup subscription on unmount
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [selectedPairs]);

  const formatPrice = (price: number, symbol: string) => {
    if (symbol.includes('BTC')) return price.toFixed(0);
    if (symbol.includes('ETH')) return price.toFixed(0);
    return price.toFixed(4);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `${(volume / 1000).toFixed(1)}K`;
    }
    return volume.toFixed(0);
  };

  const formatChange = (change: number) => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}`;
  };

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center">
          <span className="mr-2">📊</span>
          Live Market Data
        </h2>
        <div className="flex items-center space-x-2">
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isLoading ? 'Loading...' : 'Live Data'}
            </span>
          </div>
          {isConnected && (
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-md">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {isLoading && tickerData.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {selectedPairs.map((pair) => (
            <div key={pair} className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24 mb-2"></div>
              <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-32 mb-2"></div>
              <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {tickerData.map((ticker) => (
            <div
              key={ticker.symbol}
              className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600 hover:shadow-lg transition-shadow duration-200"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{ticker.symbol}</h3>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>

              <div className="mb-2">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  ${formatPrice(ticker.price, ticker.symbol)}
                </div>
              </div>

              <div className="flex items-center space-x-2 mb-2">
                <span className={`text-sm font-medium ${ticker.changePercent24h >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {formatPercent(ticker.changePercent24h)}
                </span>
                <span className={`text-xs ${ticker.changePercent24h >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  ({formatChange(ticker.change24h)})
                </span>
              </div>

              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <div>Vol: {formatVolume(ticker.volume24h)}</div>
                <div className="flex justify-between">
                  <span>H: ${formatPrice(ticker.high24h, ticker.symbol)}</span>
                  <span>L: ${formatPrice(ticker.low24h, ticker.symbol)}</span>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {ticker.lastUpdateTime.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Updates every 2 seconds
        </p>
      </div>
    </div>
  );
};

export default RealTimeMarketTicker;
