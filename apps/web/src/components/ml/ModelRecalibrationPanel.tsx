import { usePoloniexData } from '@/hooks/usePoloniexData';
import {
  ModelPerformanceMetrics,
  RecalibrationConfig,
  RecalibrationResult,
  monitorDQNModelPerformance,
  monitorMLModelPerformance,
  recalibrateDQNModel,
  recalibrateMLModel,
  scheduleModelRecalibration
} from '@/ml/modelRecalibration';
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface ModelData {
  id: string;
  name: string;
  type: string;
  performance: number;
  config?: {
    modelType?: string;
    [key: string]: unknown;
  };
}

interface MarketDataPoint {
  timestamp: number;
  price: number;
  volume: number;
}

const ModelRecalibrationPanel: React.FC = () => {
  const { marketData: poloniexMarketData, fetchMarketData } = usePoloniexData();

  const [mlModels, setMlModels] = useState<ModelData[]>([]);
  const [dqnModels, setDqnModels] = useState<ModelData[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelData | null>(null);
  const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<ModelPerformanceMetrics | null>(null);
  const [recalibrationResult, setRecalibrationResult] = useState<RecalibrationResult | null>(null);
  const [performanceHistory, setPerformanceHistory] = useState<ModelPerformanceMetrics[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalibrationConfig, setRecalibrationConfig] = useState<RecalibrationConfig>({
    monitoringFrequency: 'daily',
    driftThreshold: 0.15,
    autoRecalibrate: true,
    performanceMetrics: ['accuracy', 'f1Score', 'sharpeRatio', 'winRate'],
    validationSplit: 0.3,
    maxHistoricalModels: 5,
    recalibrationStrategy: 'incremental'
  });
  const [recalibrationStrategy, setRecalibrationStrategy] = useState<'full' | 'incremental' | 'transfer'>('incremental');
  const [recalibrationHistory, _setRecalibrationHistory] = useState<RecalibrationResult[]>([]);
  const [autoRecalibrationEnabled, setAutoRecalibrationEnabled] = useState(false);
  const [cleanupFunction, setCleanupFunction] = useState<(() => void) | null>(null);
  const CHART_COLORS = {
    driftScore: '#ef4444',
    accuracy: '#10b981',
    f1Score: '#3b82f6',
    sharpeRatio: '#8b5cf6',
    winRate: '#06b6d4'
  };



  // Load models from storage
  useEffect((): void => {
    const loadModels = async () => {
      try
      {
        // In a real implementation, this would load from a database or file storage
        // For now, we'll just check if there are any models in localStorage
        const mlModelsJson = localStorage.getItem('mlModels');
        const dqnModelsJson = localStorage.getItem('dqnModels');

        if (mlModelsJson)
        {
          setMlModels(JSON.parse(mlModelsJson));
        }

        if (dqnModelsJson)
        {
          setDqnModels(JSON.parse(dqnModelsJson));
        }
      } catch
      {
        // console.error('Error loading models:', err);
        setError('Failed to load models');
      }
    };

    loadModels();
  }, []);

  // Fetch market data
  useEffect((): () => void => {
    const fetchData = async () => {
      try
      {
        // Get market data for monitoring and recalibration
        await fetchMarketData('BTC_USDT');
        // Convert MarketData[] to MarketDataPoint[]
        const convertedData: MarketDataPoint[] = poloniexMarketData.map(data => ({
          timestamp: data.timestamp,
          price: data.close, // Use close price as the price
          volume: data.volume
        }));
        setMarketData(convertedData);
      } catch
      {
        // console.error('Error fetching market data:', err);
        setError('Failed to fetch market data');
      }
    };

    fetchData();

    // Set up interval to refresh data
    const intervalId = setInterval(fetchData, 4 * 60 * 60 * 1000); // Refresh every 4 hours

    return () => clearInterval(intervalId);
  }, [fetchMarketData, poloniexMarketData]);

  // Monitor model performance
  const handleMonitorPerformance = async (): Promise<void> => {
    if (!selectedModel)
    {
      setError('No model selected');
      return;
    }

    if (marketData.length === 0)
    {
      setError('No market data available');
      return;
    }

    setIsMonitoring(true);
    setError(null);

    try
    {
      let metrics: ModelPerformanceMetrics;

      if (selectedModel.config?.modelType)
      {
        // ML model
        metrics = await monitorMLModelPerformance(selectedModel, marketData);
      } else
      {
        // DQN model
        metrics = await monitorDQNModelPerformance(selectedModel, marketData);
      }

      setPerformanceMetrics(metrics);

      // Add to performance history
      setPerformanceHistory(prev => [...prev, metrics]);

      setIsMonitoring(false);
    } catch
    {
      // console.error('Error monitoring performance:', err);
      setError('Failed to monitor performance');
      setIsMonitoring(false);
    }
  };

  // Recalibrate model
  const handleRecalibrate = async (): Promise<void> => {
    if (!selectedModel)
    {
      setError('No model selected');
      return;
    }

    if (marketData.length === 0)
    {
      setError('No market data available');
      return;
    }

    setIsRecalibrating(true);
    setError(null);

    try
    {
      let result: RecalibrationResult;

      if (selectedModel.config?.modelType)
      {
        // ML model
        result = await recalibrateMLModel(selectedModel, marketData, recalibrationStrategy);
      } else
      {
        // DQN model
        result = await recalibrateDQNModel(selectedModel, marketData, recalibrationStrategy);
      }

      setRecalibrationResult(result);

      // Add to recalibration result
      setRecalibrationResult(result);

      // Update model list with new model
      if (selectedModel.config?.modelType)
      {
        // ML model
        setMlModels(prev => [...prev, {
          id: result.newModelId,
          name: `${selectedModel.name} (Recalibrated)`,
          type: selectedModel.type,
          performance: result.newPerformanceMetrics?.overallScore ?? 0,
          config: selectedModel.config
        }]);
      } else
      {
        // DQN model
        setDqnModels(prev => [...prev, {
          id: result.newModelId,
          name: `${selectedModel.name} (Recalibrated)`,
          type: selectedModel.type,
          performance: result.newPerformanceMetrics?.overallScore ?? 0,
          config: selectedModel.config
        }]);
      }

      setIsRecalibrating(false);
    } catch
    {
      // console.error('Error recalibrating model:', err);
      setError('Failed to recalibrate model');
      setIsRecalibrating(false);
    }
  };

  // Toggle auto-recalibration
  const handleToggleAutoRecalibration = (): void => {
    if (autoRecalibrationEnabled)
    {
      // Disable auto-recalibration
      if (cleanupFunction)
      {
        cleanupFunction();
        setCleanupFunction(null);
      }
      setAutoRecalibrationEnabled(false);
    } else
    {
      // Enable auto-recalibration
      if (!selectedModel)
      {
        setError('No model selected');
        return;
      }

      const getNewData = async (): Promise<typeof poloniexMarketData> => {
        try
        {
          await fetchMarketData('BTC_USDT');
          return poloniexMarketData;
        } catch
        {
          // console.error('Error fetching new data for auto-recalibration:', err);
          return [];
        }
      };

      // Schedule recalibration
      const scheduleRecalibration = async (): Promise<void> => {
        try
        {
          const newData = await getNewData();
          if (newData.length === 0) return;

          const result = await scheduleModelRecalibration(
            selectedModel,
            recalibrationConfig,
            newData
          );

          if (result)
          {
            // Update recalibration result
            setRecalibrationResult(result);

            // Update model list with new model
            if (selectedModel.config?.modelType)
            {
              // ML model
              setMlModels(prev => [...prev, {
                id: result.newModelId,
                name: `${selectedModel.name} (Recalibrated)`,
                type: selectedModel.type,
                performance: result.newPerformanceMetrics?.overallScore ?? 0,
                config: selectedModel.config
              }]);
            } else
            {
              // DQN model
              setDqnModels(prev => [...prev, {
                id: result.newModelId,
                name: `${selectedModel.name} (Recalibrated)`,
                type: selectedModel.type,
                performance: result.newPerformanceMetrics?.overallScore ?? 0,
                config: selectedModel.config
              }]);
            }
          }
        } catch
        {
          // console.error('Error in scheduled recalibration:', err);
        }
      };

      // Set up interval based on monitoring frequency
      let intervalMs = 24 * 60 * 60 * 1000; // Default: daily

      if (recalibrationConfig.monitoringFrequency === 'hourly')
      {
        intervalMs = 60 * 60 * 1000;
      } else if (recalibrationConfig.monitoringFrequency === 'weekly')
      {
        intervalMs = 7 * 24 * 60 * 60 * 1000;
      }

      // Initial run
      scheduleRecalibration();

      // Set up interval
      const intervalId = setInterval(scheduleRecalibration, intervalMs);

      // Cleanup function
      const cleanup = (): void => clearInterval(intervalId);

      setCleanupFunction(() => cleanup);
      setAutoRecalibrationEnabled(true);
    }
  };

  // Format performance metrics for display
  const formatMetrics = (metrics: ModelPerformanceMetrics): Array<{ name: string; value: string }> => {
    const result: Array<{ name: string; value: string }> = [];

    for (const [key, value] of Object.entries(metrics))
    {
      if (key !== 'timestamp' && key !== 'modelId' && key !== 'modelType' && typeof value === 'number')
      {
        result.push({
          name: key.charAt(0).toUpperCase() + key.slice(1),
          value: value.toFixed(4)
        });
      }
    }

    return result;
  };

  // Prepare performance history data for chart
  const prepareChartData = (): Array<{
    index: number;
    timestamp: string;
    driftScore?: number;
    accuracy?: number;
    f1Score?: number;
    sharpeRatio?: number;
    winRate?: number;
  }> => {
    return performanceHistory.map((metrics, index) => ({
      index,
      timestamp: new Date(metrics.timestamp).toLocaleDateString(),
      driftScore: metrics.driftScore,
      accuracy: metrics.accuracy,
      f1Score: metrics.f1Score,
      sharpeRatio: metrics.sharpeRatio,
      winRate: metrics.winRate
    }));
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 text-neutral-800 dark:text-white">Model Recalibration</h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Select Model</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              ML Models
            </label>
            <select
              value={selectedModel?.id || ''}
              onChange={(e) => {
                const model = mlModels.find(m => m.id === e.target.value);
                setSelectedModel(model || null);
              }}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            >
              <option value="">Select ML Model</option>
              {mlModels.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              DQN Models
            </label>
            <select
              value={selectedModel?.id || ''}
              onChange={(e) => {
                const model = dqnModels.find(m => m.id === e.target.value);
                setSelectedModel(model || null);
              }}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            >
              <option value="">Select DQN Model</option>
              {dqnModels.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Recalibration Settings</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Recalibration Strategy
            </label>
            <select
              value={recalibrationStrategy}
              onChange={(e) => setRecalibrationStrategy(e.target.value as 'full' | 'incremental' | 'transfer')}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            >
              <option value="incremental">Incremental (Fine-tune existing model)</option>
              <option value="full">Full (Retrain from scratch)</option>
              <option value="transfer">Transfer Learning (Optimize for new data)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Drift Threshold
            </label>
            <input
              type="number"
              min="0.01"
              max="0.5"
              step="0.01"
              value={recalibrationConfig.driftThreshold}
              onChange={(e) => setRecalibrationConfig({ ...recalibrationConfig, driftThreshold: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Monitoring Frequency
            </label>
            <select
              value={recalibrationConfig.monitoringFrequency}
              onChange={(e) => setRecalibrationConfig({ ...recalibrationConfig, monitoringFrequency: e.target.value as 'hourly' | 'daily' | 'weekly' })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="autoRecalibrate"
              checked={recalibrationConfig.autoRecalibrate}
              onChange={(e) => setRecalibrationConfig({ ...recalibrationConfig, autoRecalibrate: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
            />
            <label htmlFor="autoRecalibrate" className="ml-2 block text-sm text-neutral-700 dark:text-neutral-300">
              Auto-recalibrate when drift exceeds threshold
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <button
          onClick={handleMonitorPerformance}
          disabled={isMonitoring || !selectedModel}
          className={`px-4 py-2 rounded-md text-white ${isMonitoring || !selectedModel ? 'bg-neutral-400' : 'bg-blue-600 hover:bg-blue-700'
            }`}
        >
          {isMonitoring ? 'Monitoring...' : 'Monitor Performance'}
        </button>

        <button
          onClick={handleRecalibrate}
          disabled={isRecalibrating || !selectedModel}
          className={`px-4 py-2 rounded-md text-white ${isRecalibrating || !selectedModel ? 'bg-neutral-400' : 'bg-green-600 hover:bg-green-700'
            }`}
        >
          {isRecalibrating ? 'Recalibrating...' : 'Recalibrate Model'}
        </button>

        <button
          onClick={handleToggleAutoRecalibration}
          disabled={!selectedModel}
          className={`px-4 py-2 rounded-md text-white ${!selectedModel ? 'bg-neutral-400' : autoRecalibrationEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'
            }`}
        >
          {autoRecalibrationEnabled ? 'Disable Auto-Recalibration' : 'Enable Auto-Recalibration'}
        </button>
      </div>

      {performanceMetrics && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Performance Metrics</h3>

          <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {formatMetrics(performanceMetrics).map((metric, index) => (
                <div key={index}>
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{metric.name}</p>
                  <p className="text-neutral-800 dark:text-white">{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Drift Status</p>
              <div className="flex items-center mt-1">
                <div className="w-full bg-neutral-200 rounded-full h-2.5 dark:bg-neutral-700">
                  <div
                    className={`h-2.5 rounded-full ${(performanceMetrics?.driftScore ?? 0) > recalibrationConfig.driftThreshold
                        ? 'bg-red-600'
                        : 'bg-green-600'
                      }`}
                    style={{ width: `${(performanceMetrics?.driftScore ?? 0) * 100}%` }}
                  ></div>
                </div>
                <span className="ml-2 text-sm text-neutral-700 dark:text-neutral-300">
                  {(((performanceMetrics?.driftScore ?? 0) * 100).toFixed(1))}%
                </span>
              </div>
              {(performanceMetrics?.driftScore ?? 0) > recalibrationConfig.driftThreshold && (
                <p className="mt-1 text-sm text-red-600">
                  Significant drift detected. Recalibration recommended.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {recalibrationResult && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Recalibration Results</h3>

          <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Original Model</p>
                <p className="text-neutral-800 dark:text-white">{recalibrationResult.originalModelId}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">New Model</p>
                <p className="text-neutral-800 dark:text-white">{recalibrationResult.newModelId}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Recalibration Strategy</p>
                <p className="text-neutral-800 dark:text-white">{recalibrationResult.recalibrationStrategy}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Performance Improvement</p>
                <p className={`${recalibrationResult.performanceImprovement > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(recalibrationResult.performanceImprovement * 100).toFixed(1)}%
                </p>
              </div>

              <div className="col-span-2">
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Reason</p>
                <p className="text-neutral-800 dark:text-white">{recalibrationResult.reason}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {recalibrationHistory.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Recalibration History</h3>
          <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md max-h-40 overflow-y-auto">
            {recalibrationHistory.map((result, index) => (
              <div key={index} className="mb-2 p-2 bg-white dark:bg-neutral-600 rounded text-sm">
                <span className="font-medium">{new Date(result.timestamp).toLocaleString()}</span>
                <span className="mx-2">-</span>
                <span>{result.reason}</span>
                <span className="text-green-600 dark:text-green-400 ml-2">
                  (+{(result.performanceImprovement * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {performanceHistory.length > 1 && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Performance History</h3>

          <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md" style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={prepareChartData()}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="driftScore" stroke={CHART_COLORS.driftScore} name="Drift Score" />
                <Line type="monotone" dataKey="accuracy" stroke={CHART_COLORS.accuracy} name="Accuracy" />
                <Line type="monotone" dataKey="f1Score" stroke={CHART_COLORS.f1Score} name="F1 Score" />
                <Line type="monotone" dataKey="sharpeRatio" stroke={CHART_COLORS.sharpeRatio} name="Sharpe Ratio" />
                <Line type="monotone" dataKey="winRate" stroke={CHART_COLORS.winRate} name="Win Rate" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export { ModelRecalibrationPanel };
