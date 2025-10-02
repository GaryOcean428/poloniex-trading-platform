import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import {
  LiveDataConfig,
  LiveDataService,
  MarketDataPoint,
  MarketSummary,
  OrderBook,
  TradeEntry,
  liveDataEvents,
  liveDataService
} from '@/services/advancedLiveData';
import React, { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const LiveDataDashboard: React.FC = () => {
  const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC_USDT');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<MarketDataPoint[]>([]);
  const [serviceStatus, setServiceStatus] = useState<'stopped' | 'running'>('stopped');
  const [config, setConfig] = useState<LiveDataConfig>({
    primarySource: 'aggregated',
    fallbackSources: ['poloniex', 'websocket', 'rest'],
    updateInterval: 1000,
    aggregationMethod: 'weighted',
    enableAnomalyDetection: true,
    anomalyThreshold: 3.0,
    enableDataNormalization: true,
    cacheDuration: 60000,
    maxRetries: 3,
    retryDelay: 1000,
    enableCompression: true,
    logLevel: 'info'
  });

  const CHART_COLORS = {
    primary: '#06b6d4',
    secondary: '#9ca3af',
    error: '#ef4444'
  };

  // Available symbols
  const symbols = [
    'BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'ADA_USDT',
    'DOGE_USDT', 'MATIC_USDT', 'DOT_USDT', 'AVAX_USDT', 'LINK_USDT'
  ];

  // Available timeframes
  const timeframes = ['5m', '15m', '30m', '1h', '4h', '1d'];

  // Fetch market data
  const fetchMarketData = useCallback(async () => {
    try
    {
      setIsLoading(true);
      setError(null);

      const data = await liveDataService.fetchMarketData(selectedSymbol, timeframe, 100);
      setMarketData(data);

      // Extract anomalies
      const anomalyPoints = data.filter((point: MarketDataPoint) => point.isAnomaly);
      setAnomalies(anomalyPoints);

      setIsLoading(false);
    } catch (err)
    {
      // console.error('Error fetching market data:', err);
      setError(`Failed to fetch market data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  }, [selectedSymbol, timeframe]);

  // Fetch order book
  const fetchOrderBook = useCallback(async () => {
    try
    {
      const book = await liveDataService.fetchOrderBook(selectedSymbol);
      setOrderBook(book);
    } catch (err)
    {
      // console.error('Error fetching order book:', err);
      // Don't set error state to avoid disrupting the UI
    }
  }, [selectedSymbol]);

  // Fetch trades
  const fetchTrades = useCallback(async () => {
    try
    {
      const tradeData = await liveDataService.fetchTrades(selectedSymbol, 50);
      setTrades(tradeData);
    } catch (err)
    {
      // console.error('Error fetching trades:', err);
      // Don't set error state to avoid disrupting the UI
    }
  }, [selectedSymbol]);

  // Fetch market summary
  const fetchMarketSummary = useCallback(async () => {
    try
    {
      const summary = await liveDataService.fetchMarketSummary(selectedSymbol);
      setMarketSummary(summary);
    } catch (err)
    {
      // console.error('Error fetching market summary:', err);
      // Don't set error state to avoid disrupting the UI
    }
  }, [selectedSymbol]);

  // Start/stop live data service
  const toggleLiveDataService = () => {
    if (serviceStatus === 'stopped')
    {
      liveDataService.start();
      setServiceStatus('running');
    } else
    {
      liveDataService.stop();
      setServiceStatus('stopped');
    }
  };

  // Update configuration
  const updateConfig = (newConfig: Partial<LiveDataConfig>) => {
    const updatedConfig = { ...config, ...newConfig };
    setConfig(updatedConfig);

    // Restart service if running
    if (serviceStatus === 'running')
    {
      liveDataService.stop();

      // Create new service with updated config
      const newService = new LiveDataService(updatedConfig);
      newService.start();
    }
  };

  // Initial data fetch
  useEffect(() => {
    fetchMarketData();
    fetchOrderBook();
    fetchTrades();
    fetchMarketSummary();

    // Set up event listeners
    const handleDataProcessed = (data: MarketDataPoint) => {
      if (data.symbol === selectedSymbol)
      {
        setMarketData(prevData => {
          // Add new data point and keep the last 100
          const newData = [...prevData, data];
          if (newData.length > 100)
          {
            return newData.slice(-100);
          }
          return newData;
        });

        // Check for anomaly
        if (data.isAnomaly)
        {
          setAnomalies(prevAnomalies => [...prevAnomalies, data]);
        }
      }
    };

    const handleServiceStarted = () => {
      setServiceStatus('running');
    };

    const handleServiceStopped = () => {
      setServiceStatus('stopped');
    };

    liveDataEvents.on('data_processed', handleDataProcessed);
    liveDataEvents.on('service_started', handleServiceStarted);
    liveDataEvents.on('service_stopped', handleServiceStopped);

    // Clean up
    return () => {
      liveDataEvents.off('data_processed', handleDataProcessed);
      liveDataEvents.off('service_started', handleServiceStarted);
      liveDataEvents.off('service_stopped', handleServiceStopped);
    };
  }, [fetchMarketData, fetchOrderBook, fetchTrades, fetchMarketSummary, selectedSymbol]);

  // Set up polling for order book, trades, and summary
  useEffect(() => {
    const orderBookInterval = setInterval(fetchOrderBook, 10000); // 10 seconds
    const tradesInterval = setInterval(fetchTrades, 5000); // 5 seconds
    const summaryInterval = setInterval(fetchMarketSummary, 30000); // 30 seconds

    return () => {
      clearInterval(orderBookInterval);
      clearInterval(tradesInterval);
      clearInterval(summaryInterval);
    };
  }, [fetchOrderBook, fetchTrades, fetchMarketSummary]);

  // Format market data for chart
  const formatChartData = () => {
    return marketData.map(point => ({
      timestamp: new Date(point.timestamp).toLocaleTimeString(),
      close: point.close,
      volume: point.volume / 1000, // Scale down for better visualization
      isAnomaly: point.isAnomaly ? point.close : null
    }));
  };

  return (
    <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-neutral-800 dark:text-white">Advanced Live Data Dashboard</h2>

        <div className="flex items-center space-x-4">
          <button
            onClick={toggleLiveDataService}
            className={`px-4 py-2 rounded-md text-white ${serviceStatus === 'running'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
              }`}
          >
            {serviceStatus === 'running' ? 'Stop Live Data' : 'Start Live Data'}
          </button>

          <div className="relative">
            <select
              aria-label="Select symbol"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-neutral-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            >
              {symbols.map(symbol => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <select
              aria-label="Select timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-neutral-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            >
              {timeframes.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>

          <button
            onClick={fetchMarketData}
            disabled={isLoading}
            className={`px-4 py-2 rounded-md text-white ${isLoading ? 'bg-neutral-400' : 'bg-blue-600 hover:bg-blue-700'
              }`}
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {marketSummary && (
          <>
            <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md">
              <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Price</h3>
              <div className="text-3xl font-bold text-neutral-800 dark:text-white">
                ${marketSummary.lastPrice.toFixed(2)}
              </div>
              <div className={`text-sm font-medium ${marketSummary.percentChange24h >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
                }`}>
                {marketSummary.percentChange24h >= 0 ? '+' : ''}
                {marketSummary.percentChange24h.toFixed(2)}%
              </div>
            </div>

            <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md">
              <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">24h Range</h3>
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400">Low</div>
                  <div className="text-lg font-semibold text-neutral-800 dark:text-white">
                    ${marketSummary.low24h.toFixed(2)}
                  </div>
                </div>
                <div className="w-full mx-4">
                  <div className="w-full bg-neutral-200 rounded-full h-2.5 dark:bg-neutral-600">
                    <div
                      className="h-2.5 rounded-full bg-blue-600"
                      style={{
                        width: `${((marketSummary.lastPrice - marketSummary.low24h) /
                          (marketSummary.high24h - marketSummary.low24h) * 100).toFixed(0)}%`
                      }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400">High</div>
                  <div className="text-lg font-semibold text-neutral-800 dark:text-white">
                    ${marketSummary.high24h.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md">
              <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">24h Volume</h3>
              <div className="text-3xl font-bold text-neutral-800 dark:text-white">
                {marketSummary.volume24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="text-sm text-neutral-500 dark:text-neutral-400">
                ${marketSummary.quoteVolume24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Price Chart</h3>

        <div className="h-80 bg-neutral-50 dark:bg-neutral-700 p-4 rounded-md">
          {marketData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={formatChartData()}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="close"
                  stroke={CHART_COLORS.primary}
                  dot={false}
                  activeDot={{ r: 8 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="volume"
                  stroke={CHART_COLORS.secondary}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="isAnomaly"
                  stroke={CHART_COLORS.error}
                  strokeWidth={0}
                  dot={{ r: 6, fill: CHART_COLORS.error }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-neutral-500 dark:text-neutral-400">No data available</p>
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="order-book">
        <TabsList>
          <TabsTrigger value="order-book">Order Book</TabsTrigger>
          <TabsTrigger value="recent-trades">Recent Trades</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="order-book">
          {orderBook ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-md font-medium mb-2 text-green-600">Bids</h4>
                <div className="overflow-y-auto max-h-60">
                  <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                    <thead className="bg-neutral-50 dark:bg-neutral-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-bg-tertiary divide-y divide-border-subtle">
                      {orderBook.bids.map((bid, index) => (
                        <tr key={index}>
                          <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-green-600">
                            {bid.price.toFixed(2)}
                          </td>
                          <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                            {bid.amount.toFixed(6)}
                          </td>
                          <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                            {(bid.price * bid.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="text-md font-medium mb-2 text-red-600">Asks</h4>
                <div className="overflow-y-auto max-h-60">
                  <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                    <thead className="bg-neutral-50 dark:bg-neutral-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-bg-tertiary divide-y divide-border-subtle">
                      {orderBook.asks.map((ask, index) => (
                        <tr key={index}>
                          <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-red-600">
                            {ask.price.toFixed(2)}
                          </td>
                          <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                            {ask.amount.toFixed(6)}
                          </td>
                          <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                            {(ask.price * ask.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <p className="text-neutral-500 dark:text-neutral-400">No order book data available</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="recent-trades">
          {trades.length > 0 ? (
            <div className="overflow-y-auto max-h-60">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Side
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-bg-tertiary divide-y divide-border-subtle">
                  {trades.map((trade) => (
                    <tr key={trade.id}>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                        {new Date(trade.timestamp).toLocaleTimeString()}
                      </td>
                      <td className={`px-6 py-2 whitespace-nowrap text-sm font-medium ${trade.side === 'buy' ? 'text-green-600' : 'text-red-600'
                        }`}>
                        {trade.price.toFixed(2)}
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                        {trade.amount.toFixed(6)}
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${trade.side === 'buy'
                            ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                            : 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                          }`}>
                          {trade.side.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <p className="text-neutral-500 dark:text-neutral-400">No trade data available</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="anomalies">
          {anomalies.length > 0 ? (
            <div className="overflow-y-auto max-h-60">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Confidence
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Type
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-bg-tertiary divide-y divide-border-subtle">
                  {anomalies.map((anomaly, index) => (
                    <tr key={index}>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                        {new Date(anomaly.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-neutral-800 dark:text-white">
                        {anomaly.close.toFixed(2)}
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                        <div className="w-full bg-neutral-200 rounded-full h-2.5 dark:bg-neutral-700">
                          <div
                            className="h-2.5 rounded-full bg-red-600"
                            style={{ width: `${((anomaly.confidence || 0) * 100).toFixed(0)}%` }}
                          ></div>
                        </div>
                        <span className="text-xs">{((anomaly.confidence || 0) * 100).toFixed(0)}%</span>
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100">
                          PRICE ANOMALY
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <p className="text-neutral-500 dark:text-neutral-400">No anomalies detected</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="configuration">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-md font-medium mb-4 text-neutral-700 dark:text-neutral-300">Data Sources</h4>

              <div className="mb-4">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Primary Source
                </label>
                <select
                  aria-label="Primary Source"
                  value={config.primarySource}
                  onChange={(e) => updateConfig({ primarySource: e.target.value as LiveDataConfig['primarySource'] })}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
                >
                  <option value="poloniex">Poloniex API</option>
                  <option value="websocket">WebSocket</option>
                  <option value="aggregated">Aggregated (Multiple Sources)</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Aggregation Method
                </label>
                <select
                  aria-label="Aggregation Method"
                  value={config.aggregationMethod}
                  onChange={(e) => updateConfig({ aggregationMethod: e.target.value as LiveDataConfig['aggregationMethod'] })}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
                >
                  <option value="weighted">Weighted Average</option>
                  <option value="median">Median</option>
                  <option value="mean">Mean</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Update Interval (ms)
                </label>
                <input
                  aria-label="Update Interval (ms)"
                  type="number"
                  min="100"
                  max="10000"
                  step="100"
                  value={config.updateInterval}
                  onChange={(e) => updateConfig({ updateInterval: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
                />
              </div>
            </div>

            <div>
              <h4 className="text-md font-medium mb-4 text-neutral-700 dark:text-neutral-300">Data Processing</h4>

              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="enableAnomalyDetection"
                  checked={config.enableAnomalyDetection}
                  onChange={(e) => updateConfig({ enableAnomalyDetection: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
                />
                <label htmlFor="enableAnomalyDetection" className="ml-2 block text-sm text-neutral-700 dark:text-neutral-300">
                  Enable Anomaly Detection
                </label>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Anomaly Threshold (standard deviations)
                </label>
                <input
                  aria-label="Anomaly Threshold (standard deviations)"
                  type="number"
                  min="1"
                  max="10"
                  step="0.1"
                  value={config.anomalyThreshold}
                  onChange={(e) => updateConfig({ anomalyThreshold: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
                />
              </div>

              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="enableDataNormalization"
                  checked={config.enableDataNormalization}
                  onChange={(e) => updateConfig({ enableDataNormalization: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
                />
                <label htmlFor="enableDataNormalization" className="ml-2 block text-sm text-neutral-700 dark:text-neutral-300">
                  Enable Data Normalization
                </label>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Log Level
                </label>
                <select
                  aria-label="Log Level"
                  value={config.logLevel}
                  onChange={(e) => updateConfig({ logLevel: e.target.value as LiveDataConfig['logLevel'] })}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
                >
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warning</option>
                  <option value="error">Error</option>
                </select>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LiveDataDashboard;
