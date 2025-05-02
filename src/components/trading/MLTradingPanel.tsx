import React, { useState, useEffect } from 'react';
import { default as mlTrading } from '@/ml/mlTrading';
import { usePoloniexData } from '@/hooks/usePoloniexData';
import { useTradingContext } from '@/context/TradingContext';
import { useSettings } from '@/context/SettingsContext';

interface MLModelConfig {
  modelType: 'randomforest' | 'gradientboosting' | 'svm' | 'neuralnetwork';
  featureSet: 'basic' | 'technical' | 'advanced' | 'custom';
  predictionTarget: 'price_direction' | 'price_change' | 'volatility';
  timeHorizon: number;
  hyperParameters?: {
    learningRate?: number;
    maxDepth?: number;
    numEstimators?: number;
    epochs?: number;
    batchSize?: number;
  };
}

interface MLModelInfo {
  id: string;
  name: string;
  description?: string;
  config: MLModelConfig;
  performance: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    trainingSamples: number;
    validationSamples: number;
  };
  createdAt: number;
  updatedAt: number;
  lastTrainedAt: number;
  status: 'training' | 'ready' | 'error';
  filePath?: string;
}

const MLTradingPanel: React.FC = () => {
  const { getMarketData } = usePoloniexData();
  const { executeStrategy } = useTradingContext();
  const { defaultPair, timeframe } = useSettings();
  
  const [modelConfig, setModelConfig] = useState<MLModelConfig>({
    modelType: 'neuralnetwork',
    featureSet: 'technical',
    predictionTarget: 'price_direction',
    timeHorizon: 12, // 12 candles ahead
    hyperParameters: {
      learningRate: 0.001,
      epochs: 100,
      batchSize: 32
    }
  });
  
  const [modelInfo, setModelInfo] = useState<MLModelInfo | null>(null);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<any[]>([]);
  const [modelName, setModelName] = useState('My ML Model');
  
  // Fetch market data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get 500 candles for training
        const data = await getMarketData(defaultPair, timeframe, 500);
        setMarketData(data);
      } catch (err) {
        setError('Failed to fetch market data');
        console.error(err);
      }
    };
    
    fetchData();
  }, [defaultPair, timeframe, getMarketData]);
  
  // Train model
  const handleTrainModel = async () => {
    if (marketData.length === 0) {
      setError('No market data available for training');
      return;
    }
    
    setIsTraining(true);
    setError(null);
    
    try {
      const info = await mlTrading.trainMLModel(marketData, modelConfig, modelName);
      setModelInfo(info);
      setIsTraining(false);
    } catch (err) {
      setError('Failed to train model');
      console.error(err);
      setIsTraining(false);
    }
  };
  
  // Make predictions
  const handlePredict = async () => {
    if (!modelInfo) {
      setError('No trained model available');
      return;
    }
    
    if (marketData.length === 0) {
      setError('No market data available for prediction');
      return;
    }
    
    setIsPredicting(true);
    setError(null);
    
    try {
      const preds = await mlTrading.predictWithMLModel(modelInfo, marketData);
      setPredictions(preds);
      setIsPredicting(false);
    } catch (err) {
      setError('Failed to make predictions');
      console.error(err);
      setIsPredicting(false);
    }
  };
  
  // Optimize model
  const handleOptimizeModel = async () => {
    if (marketData.length === 0) {
      setError('No market data available for optimization');
      return;
    }
    
    setIsOptimizing(true);
    setError(null);
    
    try {
      const info = await mlTrading.optimizeMLModel(marketData, modelConfig, `${modelName} (Optimized)`);
      setModelInfo(info);
      setIsOptimizing(false);
    } catch (err) {
      setError('Failed to optimize model');
      console.error(err);
      setIsOptimizing(false);
    }
  };
  
  // Execute trades based on predictions
  const handleExecuteTrades = () => {
    if (predictions.length === 0) {
      setError('No predictions available');
      return;
    }
    
    // Get the latest prediction
    const latestPrediction = predictions[0];
    
    if (latestPrediction.prediction === 1 && latestPrediction.confidence > 0.6) {
      // Execute buy strategy
      executeStrategy({
        type: 'ML_STRATEGY',
        action: 'BUY',
        symbol: defaultPair,
        amount: 0.01, // Small fixed amount
        confidence: latestPrediction.confidence,
        modelId: modelInfo?.id
      });
    } else if (latestPrediction.prediction === 0 && latestPrediction.confidence > 0.6) {
      // Execute sell strategy
      executeStrategy({
        type: 'ML_STRATEGY',
        action: 'SELL',
        symbol: defaultPair,
        amount: 0.01, // Small fixed amount
        confidence: latestPrediction.confidence,
        modelId: modelInfo?.id
      });
    }
  };
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">ML Trading</h2>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">Model Configuration</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Model Name
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Model Type
            </label>
            <select
              value={modelConfig.modelType}
              onChange={(e) => setModelConfig({ ...modelConfig, modelType: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="randomforest">Random Forest</option>
              <option value="gradientboosting">Gradient Boosting</option>
              <option value="svm">Support Vector Machine</option>
              <option value="neuralnetwork">Neural Network</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Feature Set
            </label>
            <select
              value={modelConfig.featureSet}
              onChange={(e) => setModelConfig({ ...modelConfig, featureSet: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="basic">Basic</option>
              <option value="technical">Technical</option>
              <option value="advanced">Advanced</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Prediction Target
            </label>
            <select
              value={modelConfig.predictionTarget}
              onChange={(e) => setModelConfig({ ...modelConfig, predictionTarget: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="price_direction">Price Direction</option>
              <option value="price_change">Price Change</option>
              <option value="volatility">Volatility</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Time Horizon (candles)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={modelConfig.timeHorizon}
              onChange={(e) => setModelConfig({ ...modelConfig, timeHorizon: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Learning Rate
            </label>
            <input
              type="number"
              min="0.0001"
              max="0.1"
              step="0.0001"
              value={modelConfig.hyperParameters?.learningRate || 0.001}
              onChange={(e) => setModelConfig({ 
                ...modelConfig, 
                hyperParameters: { 
                  ...modelConfig.hyperParameters, 
                  learningRate: parseFloat(e.target.value) 
                } 
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Epochs
            </label>
            <input
              type="number"
              min="10"
              max="1000"
              step="10"
              value={modelConfig.hyperParameters?.epochs || 100}
              onChange={(e) => setModelConfig({ 
                ...modelConfig, 
                hyperParameters: { 
                  ...modelConfig.hyperParameters, 
                  epochs: parseInt(e.target.value) 
                } 
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-4 mb-6">
        <button
          onClick={handleTrainModel}
          disabled={isTraining || marketData.length === 0}
          className={`px-4 py-2 rounded-md text-white ${
            isTraining ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isTraining ? 'Training...' : 'Train Model'}
        </button>
        
        <button
          onClick={handleOptimizeModel}
          disabled={isOptimizing || marketData.length === 0}
          className={`px-4 py-2 rounded-md text-white ${
            isOptimizing ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isOptimizing ? 'Optimizing...' : 'Optimize Model'}
        </button>
        
        <button
          onClick={handlePredict}
          disabled={isPredicting || !modelInfo}
          className={`px-4 py-2 rounded-md text-white ${
            isPredicting || !modelInfo ? 'bg-gray-400' : 'bg-purple-600 hover:bg-purple-700'
          }`}
        >
          {isPredicting ? 'Predicting...' : 'Make Predictions'}
        </button>
        
        <button
          onClick={handleExecuteTrades}
          disabled={predictions.length === 0}
          className={`px-4 py-2 rounded-md text-white ${
            predictions.length === 0 ? 'bg-gray-400' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          Execute Trades
        </button>
      </div>
      
      {modelInfo && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">Model Information</h3>
          
          <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-md">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</p>
                <p className="text-gray-800 dark:text-white">{modelInfo.name}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Type</p>
                <p className="text-gray-800 dark:text-white">{modelInfo.config.modelType}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Accuracy</p>
                <p className="text-gray-800 dark:text-white">{(modelInfo.performance.accuracy * 100).toFixed(2)}%</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">F1 Score</p>
                <p className="text-gray-800 dark:text-white">{(modelInfo.performance.f1Score * 100).toFixed(2)}%</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Training Samples</p>
                <p className="text-gray-800 dark:text-white">{modelInfo.performance.trainingSamples}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Trained</p>
                <p className="text-gray-800 dark:text-white">
                  {new Date(modelInfo.lastTrainedAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {predictions.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">Latest Predictions</h3>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Symbol
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Prediction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-900 dark:divide-gray-700">
                {predictions.slice(0, 10).map((pred, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {new Date(pred.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {pred.symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          pred.prediction === 1
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}
                      >
                        {pred.prediction === 1 ? 'UP' : 'DOWN'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {(pred.confidence * 100).toFixed(2)}%
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

export { MLTradingPanel };