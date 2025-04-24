import React, { useState } from 'react';
import { useMockMode } from '@/context/MockModeContext';

const MockModeSettings: React.FC = () => {
  const {
    isMockMode,
    setMockMode,
    mockDataSource,
    setMockDataSource,
    mockDataDelay,
    setMockDataDelay,
    mockVolatility,
    setMockVolatility,
    mockTrendBias,
    setMockTrendBias,
    mockHistoricalPeriod,
    setMockHistoricalPeriod,
    mockDataOptions,
    updateMockDataOptions,
    resetMockSettings
  } = useMockMode();

  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Mock Mode Settings</h2>
      
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Mock Mode
          </label>
          <div className="relative inline-block w-12 mr-2 align-middle select-none">
            <input
              type="checkbox"
              id="toggle-mock-mode"
              checked={isMockMode}
              onChange={(e) => setMockMode(e.target.checked)}
              className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer"
            />
            <label
              htmlFor="toggle-mock-mode"
              className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${
                isMockMode ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            ></label>
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {isMockMode ? 'Using simulated data for testing' : 'Using real market data'}
        </p>
      </div>

      {isMockMode && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Data Source
            </label>
            <select
              value={mockDataSource}
              onChange={(e) => setMockDataSource(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="random">Random Data</option>
              <option value="historical">Historical Data</option>
              <option value="simulation">Market Simulation</option>
            </select>
          </div>

          {mockDataSource === 'historical' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Historical Period
              </label>
              <input
                type="text"
                value={mockHistoricalPeriod}
                onChange={(e) => setMockHistoricalPeriod(e.target.value)}
                placeholder="YYYY-MM-DD,YYYY-MM-DD"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Format: start-date,end-date (YYYY-MM-DD,YYYY-MM-DD)
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Data Delay (ms)
            </label>
            <input
              type="range"
              min="0"
              max="5000"
              step="100"
              value={mockDataDelay}
              onChange={(e) => setMockDataDelay(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>0ms</span>
              <span>{mockDataDelay}ms</span>
              <span>5000ms</span>
            </div>
          </div>

          {(mockDataSource === 'random' || mockDataSource === 'simulation') && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Volatility
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={mockVolatility}
                  onChange={(e) => setMockVolatility(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>Low</span>
                  <span>{mockVolatility.toFixed(2)}</span>
                  <span>High</span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Trend Bias
                </label>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={mockTrendBias}
                  onChange={(e) => setMockTrendBias(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>Bearish</span>
                  <span>{mockTrendBias.toFixed(1)}</span>
                  <span>Bullish</span>
                </div>
              </div>
            </>
          )}

          <div className="mb-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
            >
              {showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
            </button>
          </div>

          {showAdvanced && (
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md mb-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Advanced Settings
              </h3>

              <div className="mb-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="use-random-seed"
                    checked={mockDataOptions.useRandomSeed}
                    onChange={(e) => updateMockDataOptions({ useRandomSeed: e.target.checked })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="use-random-seed" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                    Use Random Seed
                  </label>
                </div>
              </div>

              {mockDataOptions.useRandomSeed && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Random Seed
                  </label>
                  <input
                    type="number"
                    value={mockDataOptions.randomSeed}
                    onChange={(e) => updateMockDataOptions({ randomSeed: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              )}

              <div className="mb-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="simulate-latency"
                    checked={mockDataOptions.simulateLatency}
                    onChange={(e) => updateMockDataOptions({ simulateLatency: e.target.checked })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="simulate-latency" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                    Simulate Network Latency
                  </label>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="simulate-errors"
                    checked={mockDataOptions.simulateErrors}
                    onChange={(e) => updateMockDataOptions({ simulateErrors: e.target.checked })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="simulate-errors" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                    Simulate Random Errors
                  </label>
                </div>
              </div>

              {mockDataOptions.simulateErrors && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Error Rate
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={mockDataOptions.errorRate}
                    onChange={(e) => updateMockDataOptions({ errorRate: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span>0%</span>
                    <span>{(mockDataOptions.errorRate * 100).toFixed(0)}%</span>
                    <span>50%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={resetMockSettings}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            >
              Reset to Defaults
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default MockModeSettings;
