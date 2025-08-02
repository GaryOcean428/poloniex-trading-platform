import React, { useState } from 'react';
import { Calendar, Download, Database, Filter, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';

interface HistoricalDataRequest {
  symbols: string[];
  timeframes: string[];
  startDate: string;
  endDate: string;
  includeVolume: boolean;
  adjustForSplits: boolean;
  adjustForDividends: boolean;
}

interface DataQuality {
  symbol: string;
  timeframe: string;
  totalCandles: number;
  missingCandles: number;
  completeness: number;
  gaps: { start: string; end: string; duration: number }[];
}

interface HistoricalData {
  symbol: string;
  timeframe: string;
  data: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

interface HistoricalDataManagerProps {
  onDataLoaded?: (data: HistoricalData[]) => void;
}

const HistoricalDataManager: React.FC<HistoricalDataManagerProps> = ({ onDataLoaded }) => {
  const [request, setRequest] = useState<HistoricalDataRequest>({
    symbols: ['BTC_USDT'],
    timeframes: ['1h'],
    startDate: '2023-01-01',
    endDate: '2024-01-01',
    includeVolume: true,
    adjustForSplits: true,
    adjustForDividends: false
  });

  const [dataQuality, setDataQuality] = useState<DataQuality[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const availableSymbols = [
    'BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'ADA_USDT', 'XRP_USDT',
    'SOL_USDT', 'DOT_USDT', 'DOGE_USDT', 'AVAX_USDT', 'SHIB_USDT'
  ];

  const availableTimeframes = [
    { value: '1m', label: '1 Minute' },
    { value: '5m', label: '5 Minutes' },
    { value: '15m', label: '15 Minutes' },
    { value: '30m', label: '30 Minutes' },
    { value: '1h', label: '1 Hour' },
    { value: '4h', label: '4 Hours' },
    { value: '1d', label: '1 Day' },
    { value: '1w', label: '1 Week' }
  ];

  const addSymbol = (symbol: string) => {
    if (!request.symbols.includes(symbol)) {
      setRequest(prev => ({
        ...prev,
        symbols: [...prev.symbols, symbol]
      }));
    }
  };

  const removeSymbol = (symbol: string) => {
    setRequest(prev => ({
      ...prev,
      symbols: prev.symbols.filter(s => s !== symbol)
    }));
  };

  const toggleTimeframe = (timeframe: string) => {
    setRequest(prev => ({
      ...prev,
      timeframes: prev.timeframes.includes(timeframe)
        ? prev.timeframes.filter(t => t !== timeframe)
        : [...prev.timeframes, timeframe]
    }));
  };

  const loadHistoricalData = async () => {
    setIsLoading(true);
    setError(null);
    setLoadingProgress(0);

    try {
      // Simulate data loading with progress
      const totalSteps = request.symbols.length * request.timeframes.length;
      let completedSteps = 0;

      const mockDataQuality: DataQuality[] = [];
      const historicalData: HistoricalData[] = [];

      for (const symbol of request.symbols) {
        for (const timeframe of request.timeframes) {
          // Simulate API call delay
          await new Promise(resolve => setTimeout(resolve, 500));

          // Mock data quality metrics
          const totalCandles = Math.floor(Math.random() * 1000) + 500;
          const missingCandles = Math.floor(Math.random() * 50);
          const completeness = ((totalCandles - missingCandles) / totalCandles) * 100;

          mockDataQuality.push({
            symbol,
            timeframe,
            totalCandles,
            missingCandles,
            completeness,
            gaps: missingCandles > 0 ? [
              {
                start: '2023-06-15T10:00:00Z',
                end: '2023-06-15T12:00:00Z',
                duration: 2 * 60 * 60 * 1000 // 2 hours in ms
              }
            ] : []
          });

          // Generate mock historical data
          const mockData: Array<{
            timestamp: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
          }> = [];

          const basePrice = 50000; // Starting price for mock data
          for (let i = 0; i < totalCandles; i++) {
            const timestamp = Date.now() - (totalCandles - i) * 60000; // 1 minute intervals
            const open = basePrice + (Math.random() - 0.5) * 1000;
            const close = open + (Math.random() - 0.5) * 100;
            const high = Math.max(open, close) + Math.random() * 50;
            const low = Math.min(open, close) - Math.random() * 50;
            const volume = Math.random() * 1000000;

            mockData.push({ timestamp, open, high, low, close, volume });
          }

          historicalData.push({
            symbol,
            timeframe,
            data: mockData
          });

          completedSteps++;
          setLoadingProgress((completedSteps / totalSteps) * 100);
        }
      }

      setDataQuality(mockDataQuality);
      
      if (onDataLoaded) {
        onDataLoaded(historicalData);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load historical data');
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
    }
  };

  const exportDataRequest = () => {
    const dataStr = JSON.stringify(request, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `data-request-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const getQualityColor = (completeness: number) => {
    if (completeness >= 95) return 'text-green-600';
    if (completeness >= 85) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getQualityIcon = (completeness: number) => {
    if (completeness >= 95) return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (completeness >= 85) return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    return <AlertCircle className="w-4 h-4 text-red-600" />;
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium flex items-center">
          <Database className="w-5 h-5 mr-2" />
          Historical Data Manager
        </h3>
        <button
          onClick={exportDataRequest}
          className="flex items-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
        >
          <Download className="w-4 h-4 mr-1" />
          Export Config
        </button>
      </div>

      {/* Symbol Selection */}
      <div className="mb-6">
        <h4 className="text-md font-medium mb-3">Trading Pairs</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
          {availableSymbols.map(symbol => (
            <button
              key={symbol}
              onClick={() => request.symbols.includes(symbol) ? removeSymbol(symbol) : addSymbol(symbol)}
              className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                request.symbols.includes(symbol)
                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                  : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {symbol}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">
          Selected: {request.symbols.length} pairs
        </p>
      </div>

      {/* Timeframe Selection */}
      <div className="mb-6">
        <h4 className="text-md font-medium mb-3">Timeframes</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {availableTimeframes.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => toggleTimeframe(value)}
              className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                request.timeframes.includes(value)
                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                  : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">
          Selected: {request.timeframes.length} timeframes
        </p>
      </div>

      {/* Date Range */}
      <div className="mb-6">
        <h4 className="text-md font-medium mb-3 flex items-center">
          <Calendar className="w-4 h-4 mr-2" />
          Date Range
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={request.startDate}
              onChange={(e) => setRequest(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={request.endDate}
              onChange={(e) => setRequest(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Data Options */}
      <div className="mb-6">
        <h4 className="text-md font-medium mb-3 flex items-center">
          <Filter className="w-4 h-4 mr-2" />
          Data Options
        </h4>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={request.includeVolume}
              onChange={(e) => setRequest(prev => ({ ...prev, includeVolume: e.target.checked }))}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">Include Volume Data</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={request.adjustForSplits}
              onChange={(e) => setRequest(prev => ({ ...prev, adjustForSplits: e.target.checked }))}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">Adjust for Stock Splits</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={request.adjustForDividends}
              onChange={(e) => setRequest(prev => ({ ...prev, adjustForDividends: e.target.checked }))}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">Adjust for Dividends</span>
          </label>
        </div>
      </div>

      {/* Load Data Button */}
      <div className="mb-6">
        <button
          onClick={loadHistoricalData}
          disabled={isLoading || request.symbols.length === 0 || request.timeframes.length === 0}
          className="w-full px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {isLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Loading... {loadingProgress.toFixed(0)}%
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4 mr-2" />
              Load Historical Data
            </>
          )}
        </button>

        {isLoading && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center">
            <AlertCircle className="w-4 h-4 text-red-600 mr-2" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        </div>
      )}

      {/* Data Quality Report */}
      {dataQuality.length > 0 && (
        <div>
          <h4 className="text-md font-medium mb-3">Data Quality Report</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Symbol
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timeframe
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Candles
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Missing
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completeness
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dataQuality.map((quality, index) => (
                  <tr key={index}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {quality.symbol}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {quality.timeframe}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {quality.totalCandles.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {quality.missingCandles}
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium ${getQualityColor(quality.completeness)}`}>
                      {quality.completeness.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="flex items-center">
                        {getQualityIcon(quality.completeness)}
                        <span className={`ml-2 ${getQualityColor(quality.completeness)}`}>
                          {quality.completeness >= 95 ? 'Excellent' : 
                           quality.completeness >= 85 ? 'Good' : 'Poor'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Stats */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 p-3 rounded-md">
              <p className="text-sm text-gray-600">Total Datasets</p>
              <p className="text-lg font-bold">{dataQuality.length}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-md">
              <p className="text-sm text-gray-600">Average Completeness</p>
              <p className="text-lg font-bold">
                {dataQuality.length > 0 
                  ? (dataQuality.reduce((sum, q) => sum + q.completeness, 0) / dataQuality.length).toFixed(1)
                  : 0}%
              </p>
            </div>
            <div className="bg-gray-50 p-3 rounded-md">
              <p className="text-sm text-gray-600">Total Candles</p>
              <p className="text-lg font-bold">
                {dataQuality.reduce((sum, q) => sum + q.totalCandles, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoricalDataManager;