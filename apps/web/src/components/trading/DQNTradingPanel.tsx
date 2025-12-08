import { usePoloniexData } from '@/hooks/usePoloniexData';
import * as dqnTrading from '@/ml/dqnTrading';
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSettings } from '../../hooks/useSettings';
import { logger } from '@shared/logger';

interface DQNConfig {
  stateDimension: number;
  actionDimension: number;
  learningRate: number;
  gamma: number;
  epsilonStart: number;
  epsilonEnd: number;
  epsilonDecay: number;
  memorySize: number;
  batchSize: number;
  updateTargetFreq: number;
  hiddenLayers: number[];
  activationFunction: string;
  optimizer: string;
}

interface DQNModelInfo {
  id: string;
  name: string;
  description: string;
  config: DQNConfig;
  performance: {
    averageReward: number;
    cumulativeReward: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    episodeRewards: number[];
    trainingEpisodes: number;
  };
  createdAt: number;
  updatedAt: number;
  lastTrainedAt: number;
  status: 'training' | 'ready' | 'error';
  episodesCompleted: number;
  totalTrainingSteps: number;
}

interface DQNAction {
  timestamp: number;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  position?: number;
  price?: number;
}

const DQNTradingPanel: React.FC = () => {
  const { marketData: poloniexMarketData, fetchMarketData } = usePoloniexData();
  const { defaultPair, timeframe } = useSettings();

  const [modelConfig, setModelConfig] = useState<Partial<DQNConfig>>({
    stateDimension: 8, // Default state dimension
    actionDimension: 3, // Default action dimension (buy, sell, hold)
    learningRate: 0.0001,
    gamma: 0.99,
    epsilonStart: 1.0,
    epsilonEnd: 0.01,
    epsilonDecay: 0.995,
    memorySize: 10000,
    batchSize: 32,
    updateTargetFreq: 100,
    hiddenLayers: [128, 64],
    activationFunction: 'relu',
    optimizer: 'adam',
  });

  const [modelInfo, setModelInfo] = useState<DQNModelInfo | null>(null);
  const [actions, setActions] = useState<DQNAction[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [isGettingActions, setIsGettingActions] = useState(false);
  const [isContinuingTraining, setIsContinuingTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const [marketData, setMarketData] = useState<unknown[]>([]);
  const [modelName, setModelName] = useState('My DQN Model');
  const [episodes, setEpisodes] = useState(100);
  const [additionalEpisodes, setAdditionalEpisodes] = useState(50);
  const [performanceData, setPerformanceData] = useState<{ episode: number; reward: number }[]>([]);

  // Fetch market data
  useEffect(() => {
    const fetchData = async () => {
      try
      {
        // Get market data for training
        await fetchMarketData(defaultPair);
        // Market data is now available via poloniexMarketData
      } catch (err)
      {
        setError('Failed to fetch market data');
        logger.error('Failed to fetch market data', err instanceof Error ? err : new Error(String(err)), {
          component: 'DQNTradingPanel',
          action: 'fetch_market_data',
          pair: defaultPair
        });
      }
    };

    fetchData();
  }, [defaultPair, timeframe, fetchMarketData, poloniexMarketData]);

  // Train model
  const handleTrainModel = async () => {
    if (poloniexMarketData.length === 0)
    {
      setError('No market data available for training');
      return;
    }

    setIsTraining(true);
    setError(null);

    try
    {
      // Convert poloniex market data to MarketCandle format
      const convertedMarketData = poloniexMarketData.map(data => ({
        timestamp: data.timestamp,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: data.volume,
        symbol: data.pair
      }));
      
      const info = await dqnTrading.trainDQNModel(convertedMarketData, modelConfig as DQNConfig, modelName, episodes);
      setModelInfo(info);

      // Prepare performance data for chart
      const chartData = info.performance.episodeRewards.map((reward: number, index: number) => ({
        episode: index + 1,
        reward,
      }));
      setPerformanceData(chartData);

      setIsTraining(false);
    } catch (err)
    {
      setError('Failed to train model');
      logger.error('Failed to train DQN model', err instanceof Error ? err : new Error(String(err)), {
        component: 'DQNTradingPanel',
        action: 'train_model',
        episodes
      });
      setIsTraining(false);
    }
  };

  // Get trading actions
  const handleGetActions = async () => {
    if (!modelInfo)
    {
      setError('No trained model available');
      return;
    }

    if (poloniexMarketData.length === 0)
    {
      setError('No market data available for prediction');
      return;
    }

    setIsGettingActions(true);
    setError(null);

    try
    {
      // Convert poloniex market data to MarketCandle format
      const convertedMarketData = poloniexMarketData.map(data => ({
        timestamp: data.timestamp,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: data.volume,
        symbol: data.pair
      }));
      
      const actionsList = await dqnTrading.getDQNActions(modelInfo, convertedMarketData);
      setActions(actionsList);
      setIsGettingActions(false);
    } catch (err)
    {
      setError('Failed to get trading actions');
      logger.error('Failed to get DQN actions', err instanceof Error ? err : new Error(String(err)), {
        component: 'DQNTradingPanel',
        action: 'get_actions',
        modelId: modelInfo?.id
      });
      setIsGettingActions(false);
    }
  };

  // Continue training
  const handleContinueTraining = async () => {
    if (!modelInfo)
    {
      setError('No trained model available');
      return;
    }

    if (poloniexMarketData.length === 0)
    {
      setError('No market data available for training');
      return;
    }

    setIsContinuingTraining(true);
    setError(null);

    try
    {
      // Convert poloniex market data to MarketCandle format
      const convertedMarketData = poloniexMarketData.map(data => ({
        timestamp: data.timestamp,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: data.volume,
        symbol: data.pair
      }));
      
      const updatedInfo = await dqnTrading.continueDQNTraining(modelInfo, convertedMarketData);
      setModelInfo(updatedInfo);

      // Update performance data for chart
      const chartData = updatedInfo.performance.episodeRewards.map((reward: number, index: number) => ({
        episode: index + 1,
        reward,
      }));
      setPerformanceData(chartData);

      setIsContinuingTraining(false);
    } catch (err)
    {
      setError('Failed to continue training');
      logger.error('Failed to continue DQN training', err instanceof Error ? err : new Error(String(err)), {
        component: 'DQNTradingPanel',
        action: 'continue_training',
        modelId: modelInfo?.id
      });
      setIsContinuingTraining(false);
    }
  };

  // Execute trades based on DQN actions
  const handleExecuteTrades = () => {
    if (actions.length === 0)
    {
      setError('No actions available');
      return;
    }

    // Get the latest action
    const latestAction = actions[0];
    if (!latestAction) {
      setError('No actions available');
      return;
    }

    if (latestAction.action === 'buy')
    {
      // Execute buy strategy
      // TODO: Implement executeStrategy functionality
      logger.info('DQN Strategy - BUY signal', {
        component: 'DQNTradingPanel',
        type: 'DQN_STRATEGY',
        action: 'BUY',
        symbol: defaultPair,
        amount: 0.01,
        confidence: latestAction.confidence,
        modelId: modelInfo?.id
      });
    } else if (latestAction.action === 'sell')
    {
      // Execute sell strategy
      // TODO: Implement executeStrategy functionality
      logger.info('DQN Strategy - SELL signal', {
        component: 'DQNTradingPanel',
        type: 'DQN_STRATEGY',
        action: 'SELL',
        symbol: defaultPair,
        amount: 0.01,
        confidence: latestAction.confidence,
        modelId: modelInfo?.id
      });
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 text-neutral-800 dark:text-white">DQN Reinforcement Learning Trading</h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Model Configuration</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Model Name
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
              title="Enter model name"
              placeholder="My DQN Model"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Training Episodes
            </label>
            <input
              type="number"
              min="10"
              max="1000"
              value={episodes}
              onChange={(e) => setEpisodes(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
              title="Number of training episodes"
              placeholder="100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Learning Rate
            </label>
            <input
              type="number"
              min="0.00001"
              max="0.1"
              step="0.00001"
              value={modelConfig.learningRate}
              onChange={(e) => setModelConfig({ ...modelConfig, learningRate: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
              title="Learning rate for model training"
              placeholder="0.0001"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Discount Factor (Gamma)
            </label>
            <input
              type="number"
              min="0.5"
              max="0.999"
              step="0.001"
              value={modelConfig.gamma}
              onChange={(e) => setModelConfig({ ...modelConfig, gamma: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
              title="Discount factor for future rewards"
              placeholder="0.99"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Initial Exploration Rate
            </label>
            <input
              type="number"
              min="0.1"
              max="1.0"
              step="0.1"
              value={modelConfig.epsilonStart}
              onChange={(e) => setModelConfig({ ...modelConfig, epsilonStart: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
              title="Initial exploration rate"
              placeholder="1.0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Final Exploration Rate
            </label>
            <input
              type="number"
              min="0.001"
              max="0.5"
              step="0.001"
              value={modelConfig.epsilonEnd}
              onChange={(e) => setModelConfig({ ...modelConfig, epsilonEnd: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
              title="Final exploration rate"
              placeholder="0.01"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <button
          onClick={handleTrainModel}
          disabled={isTraining || poloniexMarketData.length === 0}
          className={`px-4 py-2 rounded-md text-white ${isTraining ? 'bg-neutral-400' : 'bg-blue-600 hover:bg-blue-700'
            }`}
        >
          {isTraining ? 'Training...' : 'Train DQN Model'}
        </button>

        <button
          onClick={handleGetActions}
          disabled={isGettingActions || !modelInfo}
          className={`px-4 py-2 rounded-md text-white ${isGettingActions || !modelInfo ? 'bg-neutral-400' : 'bg-purple-600 hover:bg-purple-700'
            }`}
        >
          {isGettingActions ? 'Getting Actions...' : 'Get Trading Actions'}
        </button>

        <button
          onClick={handleExecuteTrades}
          disabled={actions.length === 0}
          className={`px-4 py-2 rounded-md text-white ${actions.length === 0 ? 'bg-neutral-400' : 'bg-red-600 hover:bg-red-700'
            }`}
        >
          Execute Trades
        </button>
      </div>

      {modelInfo && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Model Information</h3>

          <div className="bg-neutral-100 dark:bg-neutral-700 p-4 rounded-md">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Name</p>
                <p className="text-neutral-800 dark:text-white">{modelInfo.name}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Episodes</p>
                <p className="text-neutral-800 dark:text-white">{modelInfo.episodesCompleted}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Average Reward</p>
                <p className="text-neutral-800 dark:text-white">{modelInfo.performance.averageReward.toFixed(4)}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Sharpe Ratio</p>
                <p className="text-neutral-800 dark:text-white">{modelInfo.performance.sharpeRatio.toFixed(4)}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Win Rate</p>
                <p className="text-neutral-800 dark:text-white">{(modelInfo.performance.winRate * 100).toFixed(2)}%</p>
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Last Trained</p>
                <p className="text-neutral-800 dark:text-white">
                  {new Date(modelInfo.lastTrainedAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {performanceData.length > 0 && (
            <div className="mt-4">
              <h4 className="text-md font-medium mb-2 text-neutral-700 dark:text-neutral-300">Training Performance</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={performanceData}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="episode" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="reward" stroke="#06b6d4" activeDot={{ r: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="mt-6">
            <h4 className="text-md font-medium mb-2 text-neutral-700 dark:text-neutral-300">Continue Training</h4>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min="10"
                max="500"
                value={additionalEpisodes}
                onChange={(e) => setAdditionalEpisodes(parseInt(e.target.value))}
                className="w-32 px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
                title="Additional training episodes"
                placeholder="50"
              />
              <button
                onClick={handleContinueTraining}
                disabled={isContinuingTraining}
                className={`px-4 py-2 rounded-md text-white ${isContinuingTraining ? 'bg-neutral-400' : 'bg-green-600 hover:bg-green-700'
                  }`}
              >
                {isContinuingTraining ? 'Training...' : 'Continue Training'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actions.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">Trading Actions</h3>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
              <thead className="bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                    Symbol
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                    Confidence
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200 dark:bg-neutral-900 dark:divide-neutral-700">
                {actions.slice(0, 10).map((action, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                      {new Date(action.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                      {action.symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${action.action === 'buy'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : action.action === 'sell'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-300'
                          }`}
                      >
                        {action.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                      {(action.confidence * 100).toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                      {action.price ? `$${action.price.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export { DQNTradingPanel };
