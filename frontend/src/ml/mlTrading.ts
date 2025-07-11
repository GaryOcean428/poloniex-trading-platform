import * as tf from '@tensorflow/tfjs';

/**
 * Machine Learning Trading Module
 * 
 * This module provides ML-based trading strategies and models for the Poloniex Trading Platform.
 * It includes feature engineering, model training, prediction, and evaluation capabilities.
 */

// Types for ML trading
export interface MLModelConfig {
  modelType: 'randomforest' | 'gradientboosting' | 'svm' | 'neuralnetwork';
  featureSet: 'basic' | 'technical' | 'advanced' | 'custom';
  predictionTarget: 'price_direction' | 'price_change' | 'volatility';
  timeHorizon: number; // in candles
  hyperParameters?: Record<string, any>;
  customFeatures?: string[];
}

export interface MLModelInfo {
  id: string;
  name: string;
  description: string;
  config: MLModelConfig;
  performance: MLModelPerformance;
  createdAt: number;
  updatedAt: number;
  lastTrainedAt: number;
  status: 'training' | 'ready' | 'error';
  filePath?: string;
}

export interface MLModelPerformance {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  trainingSamples: number;
  validationSamples: number;
  confusionMatrix?: number[][];
}

export interface MLPrediction {
  timestamp: number;
  symbol: string;
  prediction: number;
  confidence: number;
  features?: Record<string, number>;
}

// Feature engineering functions
const calculateTechnicalIndicators = (data: any[]): Record<string, number[]> => {
  const features: Record<string, number[]> = {};
  
  // Simple Moving Averages
  features.sma5 = calculateSMA(data.map(d => d.close), 5);
  features.sma10 = calculateSMA(data.map(d => d.close), 10);
  features.sma20 = calculateSMA(data.map(d => d.close), 20);
  
  // Exponential Moving Averages
  features.ema5 = calculateEMA(data.map(d => d.close), 5);
  features.ema10 = calculateEMA(data.map(d => d.close), 10);
  features.ema20 = calculateEMA(data.map(d => d.close), 20);
  features.ema12 = calculateEMA(data.map(d => d.close), 12);
  features.ema26 = calculateEMA(data.map(d => d.close), 26);
  
  // MACD
  features.macd = features.ema12.map((val, i) => val - features.ema26[i]);
  features.macd_signal = calculateEMA(features.macd, 9);
  features.macd_hist = features.macd.map((val, i) => val - features.macd_signal[i]);
  
  // RSI (Relative Strength Index)
  features.rsi = calculateRSI(data.map(d => d.close), 14);
  
  // Bollinger Bands
  features.bb_middle = features.sma20;
  const std20 = calculateStandardDeviation(data.map(d => d.close), 20);
  features.bb_upper = features.bb_middle.map((val, i) => val + (std20[i] * 2));
  features.bb_lower = features.bb_middle.map((val, i) => val - (std20[i] * 2));
  
  // Price momentum
  features.momentum5 = calculateMomentum(data.map(d => d.close), 5);
  features.momentum10 = calculateMomentum(data.map(d => d.close), 10);
  features.momentum20 = calculateMomentum(data.map(d => d.close), 20);
  
  // Volatility
  features.volatility5 = calculateVolatility(data.map(d => d.close), 5, features.sma5);
  features.volatility10 = calculateVolatility(data.map(d => d.close), 10, features.sma10);
  features.volatility20 = calculateVolatility(data.map(d => d.close), 20, features.sma20);
  
  // Volume indicators
  features.volume_sma5 = calculateSMA(data.map(d => d.volume), 5);
  features.volume_ratio = data.map((d, i) => 
    features.volume_sma5[i] ? d.volume / features.volume_sma5[i] : 1
  );
  
  // Price ratios
  features.close_to_sma5 = data.map((d, i) => 
    features.sma5[i] ? d.close / features.sma5[i] : 1
  );
  features.close_to_sma10 = data.map((d, i) => 
    features.sma10[i] ? d.close / features.sma10[i] : 1
  );
  features.close_to_sma20 = data.map((d, i) => 
    features.sma20[i] ? d.close / features.sma20[i] : 1
  );
  
  // Candle patterns
  features.body_size = data.map(d => (d.close - d.open) / d.open);
  features.upper_shadow = data.map(d => 
    (d.high - Math.max(d.open, d.close)) / d.open
  );
  features.lower_shadow = data.map(d => 
    (Math.min(d.open, d.close) - d.low) / d.open
  );
  
  return features;
};

// Helper functions for technical indicators
const calculateSMA = (data: number[], period: number): number[] => {
  const result: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    result.push(sum / period);
  }
  
  return result;
};

const calculateEMA = (data: number[], period: number): number[] => {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // Start with SMA for the first value
  let ema = 0;
  let validDataPoints = 0;
  
  for (let i = 0; i < period; i++) {
    if (!isNaN(data[i])) {
      ema += data[i];
      validDataPoints++;
    }
  }
  
  if (validDataPoints > 0) {
    ema /= validDataPoints;
  }
  
  // Fill initial values with NaN
  for (let i = 0; i < period - 1; i++) {
    result.push(NaN);
  }
  
  result.push(ema);
  
  // Calculate EMA for the rest
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  
  return result;
};

const calculateRSI = (data: number[], period: number): number[] => {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate price changes
  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  // Fill initial values with NaN
  for (let i = 0; i < period; i++) {
    result.push(NaN);
  }
  
  // Calculate first average gain and loss
  let avgGain = gains.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  
  // Calculate RSI for the first period
  let rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
  result.push(100 - (100 / (1 + rs)));
  
  // Calculate RSI for the rest
  for (let i = period; i < data.length - 1; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    
    rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
    result.push(100 - (100 / (1 + rs)));
  }
  
  return result;
};

const calculateStandardDeviation = (data: number[], period: number): number[] => {
  const result: number[] = [];
  const sma = calculateSMA(data, period);
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    
    let sumSquaredDiff = 0;
    for (let j = 0; j < period; j++) {
      sumSquaredDiff += Math.pow(data[i - j] - sma[i], 2);
    }
    
    result.push(Math.sqrt(sumSquaredDiff / period));
  }
  
  return result;
};

const calculateMomentum = (data: number[], period: number): number[] => {
  const result: number[] = [];
  
  // Fill initial values with NaN
  for (let i = 0; i < period; i++) {
    result.push(NaN);
  }
  
  // Calculate momentum
  for (let i = period; i < data.length; i++) {
    result.push(data[i] / data[i - period] - 1);
  }
  
  return result;
};

const calculateVolatility = (data: number[], period: number, sma: number[]): number[] => {
  const stdDev = calculateStandardDeviation(data, period);
  
  return stdDev.map((val, i) => 
    sma[i] ? val / sma[i] : NaN
  );
};

const prepareFeatures = (data: any[], config: MLModelConfig): { features: number[][], labels: number[] } => {
  // Calculate technical indicators
  const technicalFeatures = calculateTechnicalIndicators(data);
  
  // Select features based on config
  let selectedFeatures: string[] = [];
  
  switch (config.featureSet) {
    case 'basic':
      selectedFeatures = [
        'close_to_sma5', 'close_to_sma10', 'close_to_sma20',
        'momentum5', 'momentum10', 'volume_ratio'
      ];
      break;
    case 'technical':
      selectedFeatures = [
        'close_to_sma5', 'close_to_sma10', 'close_to_sma20',
        'momentum5', 'momentum10', 'momentum20',
        'rsi', 'macd', 'macd_hist',
        'volatility10', 'volume_ratio'
      ];
      break;
    case 'advanced':
      selectedFeatures = [
        'close_to_sma5', 'close_to_sma10', 'close_to_sma20',
        'momentum5', 'momentum10', 'momentum20',
        'rsi', 'macd', 'macd_hist', 'macd_signal',
        'volatility5', 'volatility10', 'volatility20',
        'volume_ratio', 'body_size', 'upper_shadow', 'lower_shadow',
        'bb_upper', 'bb_middle', 'bb_lower'
      ];
      break;
    case 'custom':
      selectedFeatures = config.customFeatures || ['close_to_sma10', 'rsi', 'volume_ratio'];
      break;
  }
  
  // Create feature matrix
  const featureMatrix: number[][] = [];
  
  // Ensure all arrays have the same length
  const length = data.length;
  
  for (let i = 0; i < length; i++) {
    const featureVector: number[] = [];
    
    for (const feature of selectedFeatures) {
      if (technicalFeatures[feature] && technicalFeatures[feature][i] !== undefined) {
        featureVector.push(technicalFeatures[feature][i]);
      } else {
        featureVector.push(NaN); // Will be handled later
      }
    }
    
    featureMatrix.push(featureVector);
  }
  
  // Create labels based on prediction target
  const labels: number[] = [];
  
  switch (config.predictionTarget) {
    case 'price_direction':
      // 1 if price goes up in the next timeHorizon candles, 0 otherwise
      for (let i = 0; i < length - config.timeHorizon; i++) {
        labels.push(data[i + config.timeHorizon].close > data[i].close ? 1 : 0);
      }
      // Pad with NaN for the last timeHorizon candles
      for (let i = 0; i < config.timeHorizon; i++) {
        labels.push(NaN);
      }
      break;
    case 'price_change':
      // Percentage change in the next timeHorizon candles
      for (let i = 0; i < length - config.timeHorizon; i++) {
        const change = (data[i + config.timeHorizon].close - data[i].close) / data[i].close;
        // Discretize into classes: -1 (down), 0 (sideways), 1 (up)
        if (change > 0.01) labels.push(1);
        else if (change < -0.01) labels.push(-1);
        else labels.push(0);
      }
      // Pad with NaN for the last timeHorizon candles
      for (let i = 0; i < config.timeHorizon; i++) {
        labels.push(NaN);
      }
      break;
    case 'volatility':
      // Predict if volatility will increase
      for (let i = 0; i < length - config.timeHorizon; i++) {
        const currentVol = technicalFeatures.volatility10[i];
        const futureVol = technicalFeatures.volatility10[i + config.timeHorizon];
        labels.push(futureVol > currentVol ? 1 : 0);
      }
      // Pad with NaN for the last timeHorizon candles
      for (let i = 0; i < config.timeHorizon; i++) {
        labels.push(NaN);
      }
      break;
  }
  
  // Remove rows with NaN values
  const validIndices: number[] = [];
  for (let i = 0; i < length; i++) {
    if (!featureMatrix[i].some(isNaN) && !isNaN(labels[i])) {
      validIndices.push(i);
    }
  }
  
  const cleanFeatures = validIndices.map(i => featureMatrix[i]);
  const cleanLabels = validIndices.map(i => labels[i]);
  
  return { features: cleanFeatures, labels: cleanLabels };
};

// ML model training and prediction
export const trainMLModel = async (
  data: any[],
  config: MLModelConfig,
  modelName: string = 'default_model'
): Promise<MLModelInfo> => {
  try {
    // Prepare features and labels
    const { features, labels } = prepareFeatures(data, config);
    
    // Split data into training and validation sets
    const splitIndex = Math.floor(features.length * 0.8);
    const X_train = features.slice(0, splitIndex);
    const y_train = labels.slice(0, splitIndex);
    const X_val = features.slice(splitIndex);
    const y_val = labels.slice(splitIndex);
    
    // Standardize features
    const { mean, std } = calculateMeanAndStd(X_train);
    const X_train_scaled = standardizeFeatures(X_train, mean, std);
    const X_val_scaled = standardizeFeatures(X_val, mean, std);
    
    // Convert to tensors
    const xs_train = tf.tensor2d(X_train_scaled);
    const ys_train = tf.tensor1d(y_train);
    const xs_val = tf.tensor2d(X_val_scaled);
    const ys_val = tf.tensor1d(y_val);
    
    // Create model
    const model = createModel(config, features[0].length);
    
    // Train model
    await model.fit(xs_train, ys_train, {
      epochs: 50,
      batchSize: 32,
      validationData: [xs_val, ys_val],
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`Epoch ${epoch}: loss = ${logs?.loss}, val_loss = ${logs?.val_loss}`);
        }
      }
    });
    
    // Evaluate model
    const predictions = model.predict(xs_val) as tf.Tensor;
    const y_pred = Array.from(predictions.dataSync()).map(p => p > 0.5 ? 1 : 0);
    
    // Calculate performance metrics
    const performance: MLModelPerformance = {
      accuracy: calculateAccuracy(y_val, y_pred),
      precision: calculatePrecision(y_val, y_pred),
      recall: calculateRecall(y_val, y_pred),
      f1Score: calculateF1Score(y_val, y_pred),
      trainingSamples: X_train.length,
      validationSamples: X_val.length
    };
    
    // Save model
    const modelId = `${config.modelType}_${Date.now()}`;
    const modelsDir = './models';
    
    // Create models directory if it doesn't exist
    try {
      // Dynamic import for Node.js environments only
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('fs');
        if (!fs.existsSync(modelsDir)) {
          fs.mkdirSync(modelsDir, { recursive: true });
        }
      }
    } catch (error) {
      console.error('Error creating models directory:', error);
    }
    
    // Save model
    const modelPath = `${modelsDir}/${modelId}`;
    await model.save(`file://${modelPath}`);
    
    // Create model info
    const modelInfo: MLModelInfo = {
      id: modelId,
      name: modelName,
      description: `${config.modelType} model for ${config.predictionTarget} prediction with ${config.featureSet} features`,
      config,
      performance,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTrainedAt: Date.now(),
      status: 'ready',
      filePath: modelPath
    };
    
    // Save model info
    try {
      // Dynamic import for Node.js environments only
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('fs');
        const modelInfoPath = `${modelsDir}/${modelId}_info.json`;
        fs.writeFileSync(modelInfoPath, JSON.stringify(modelInfo, null, 2));
      }
    } catch (error) {
      console.error('Error saving model info:', error);
    }
    
    // Clean up tensors
    xs_train.dispose();
    ys_train.dispose();
    xs_val.dispose();
    ys_val.dispose();
    predictions.dispose();
    
    return modelInfo;
  } catch (error) {
    console.error('Error training ML model:', error);
    throw error;
  }
};

export const predictWithMLModel = async (
  modelInfo: MLModelInfo,
  data: any[]
): Promise<MLPrediction[]> => {
  try {
    // Load model
    const model = await tf.loadLayersModel(`file://${modelInfo.filePath}/model.json`);
    
    // Prepare features
    const { features } = prepareFeatures(data, modelInfo.config);
    
    // Load mean and std from model info
    let mean: number[] = [];
    let std: number[] = [];
    
    try {
      // Dynamic import for Node.js environments only
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('fs');
        const statsPath = `${modelInfo.filePath}/stats.json`;
        if (fs.existsSync(statsPath)) {
          const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
          mean = stats.mean;
          std = stats.std;
        } else {
          // If stats file doesn't exist, calculate from features
          const result = calculateMeanAndStd(features);
          mean = result.mean;
          std = result.std;
        }
      } else {
        // Browser environment, calculate from features
        const result = calculateMeanAndStd(features);
        mean = result.mean;
        std = result.std;
      }
    } catch (error) {
      console.error('Error loading model stats:', error);
      // Fallback to calculating from features
      const result = calculateMeanAndStd(features);
      mean = result.mean;
      std = result.std;
    }
    
    // Standardize features
    const features_scaled = standardizeFeatures(features, mean, std);
    
    // Make predictions
    const xs = tf.tensor2d(features_scaled);
    const predictions = model.predict(xs) as tf.Tensor;
    const predictionValues = Array.from(predictions.dataSync());
    
    // Create prediction objects
    const result: MLPrediction[] = [];
    
    for (let i = 0; i < data.length; i++) {
      // Skip if features couldn't be calculated for this candle
      if (i >= features.length) continue;
      
      const confidence = predictionValues[i];
      const prediction = confidence > 0.5 ? 1 : 0;
      
      result.push({
        timestamp: data[i].timestamp,
        symbol: data[i].symbol,
        prediction,
        confidence
      });
    }
    
    // Clean up tensors
    xs.dispose();
    predictions.dispose();
    
    return result;
  } catch (error) {
    console.error('Error making predictions with ML model:', error);
    throw error;
  }
};

export const optimizeMLModel = async (
  data: any[],
  baseConfig: MLModelConfig,
  modelName: string = 'optimized_model'
): Promise<MLModelInfo> => {
  try {
    // Prepare features and labels
    const { features, labels } = prepareFeatures(data, baseConfig);
    
    // Split data into training and validation sets
    const splitIndex = Math.floor(features.length * 0.8);
    const X_train = features.slice(0, splitIndex);
    const y_train = labels.slice(0, splitIndex);
    const X_val = features.slice(splitIndex);
    const y_val = labels.slice(splitIndex);
    
    // Standardize features
    const { mean, std } = calculateMeanAndStd(X_train);
    const X_train_scaled = standardizeFeatures(X_train, mean, std);
    const X_val_scaled = standardizeFeatures(X_val, mean, std);
    
    // Convert to tensors
    const xs_train = tf.tensor2d(X_train_scaled);
    const ys_train = tf.tensor1d(y_train);
    const xs_val = tf.tensor2d(X_val_scaled);
    const ys_val = tf.tensor1d(y_val);
    
    // Define hyperparameter options based on model type
    let bestConfig = { ...baseConfig };
    let bestPerformance = -Infinity;
    
    switch (baseConfig.modelType) {
      case 'neuralnetwork':
        // Test different network architectures
        const hiddenLayerOptions = [
          [32],
          [64],
          [128],
          [32, 16],
          [64, 32],
          [128, 64]
        ];
        
        const learningRateOptions = [0.001, 0.01, 0.1];
        
        for (const hiddenLayers of hiddenLayerOptions) {
          for (const learningRate of learningRateOptions) {
            const config = {
              ...baseConfig,
              hyperParameters: {
                ...baseConfig.hyperParameters,
                hiddenLayers,
                learningRate
              }
            };
            
            // Create and train model
            const model = createModel(config, features[0].length);
            
            await model.fit(xs_train, ys_train, {
              epochs: 20,
              batchSize: 32,
              validationData: [xs_val, ys_val],
              verbose: 0
            });
            
            // Evaluate model
            const predictions = model.predict(xs_val) as tf.Tensor;
            const y_pred = Array.from(predictions.dataSync()).map(p => p > 0.5 ? 1 : 0);
            
            // Calculate F1 score
            const f1Score = calculateF1Score(y_val, y_pred);
            
            if (f1Score > bestPerformance) {
              bestPerformance = f1Score;
              bestConfig = config;
            }
            
            // Clean up
            predictions.dispose();
            model.dispose();
          }
        }
        break;
        
      default:
        // For other model types, use default hyperparameters
        bestConfig = baseConfig;
        break;
    }
    
    // Clean up tensors
    xs_train.dispose();
    ys_train.dispose();
    xs_val.dispose();
    ys_val.dispose();
    
    // Train model with best hyperparameters
    return trainMLModel(data, bestConfig, modelName);
  } catch (error) {
    console.error('Error optimizing ML model:', error);
    throw error;
  }
};

// Helper functions for model creation and evaluation
const createModel = (config: MLModelConfig, inputDimension: number): tf.LayersModel => {
  const model = tf.sequential();
  
  // Get hyperparameters
  const hyperParams = config.hyperParameters || {};
  const hiddenLayers = hyperParams.hiddenLayers || [64, 32];
  const learningRate = hyperParams.learningRate || 0.01;
  const activation = hyperParams.activation || 'relu';
  
  // Input layer
  model.add(tf.layers.dense({
    units: hiddenLayers[0],
    activation,
    inputShape: [inputDimension]
  }));
  
  // Hidden layers
  for (let i = 1; i < hiddenLayers.length; i++) {
    model.add(tf.layers.dense({
      units: hiddenLayers[i],
      activation
    }));
  }
  
  // Output layer
  model.add(tf.layers.dense({
    units: 1,
    activation: 'sigmoid'
  }));
  
  // Compile model
  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });
  
  return model;
};

const calculateMeanAndStd = (features: number[][]): { mean: number[], std: number[] } => {
  const numFeatures = features[0].length;
  const mean: number[] = Array(numFeatures).fill(0);
  const std: number[] = Array(numFeatures).fill(0);
  
  // Calculate mean
  for (const sample of features) {
    for (let i = 0; i < numFeatures; i++) {
      mean[i] += sample[i];
    }
  }
  
  for (let i = 0; i < numFeatures; i++) {
    mean[i] /= features.length;
  }
  
  // Calculate standard deviation
  for (const sample of features) {
    for (let i = 0; i < numFeatures; i++) {
      std[i] += Math.pow(sample[i] - mean[i], 2);
    }
  }
  
  for (let i = 0; i < numFeatures; i++) {
    std[i] = Math.sqrt(std[i] / features.length);
    // Prevent division by zero
    if (std[i] === 0) std[i] = 1;
  }
  
  return { mean, std };
};

const standardizeFeatures = (features: number[][], mean: number[], std: number[]): number[][] => {
  return features.map(sample => 
    sample.map((value, i) => (value - mean[i]) / std[i])
  );
};

const calculateAccuracy = (actual: number[], predicted: number[]): number => {
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === predicted[i]) correct++;
  }
  return correct / actual.length;
};

const calculatePrecision = (actual: number[], predicted: number[]): number => {
  let truePositives = 0;
  let falsePositives = 0;
  
  for (let i = 0; i < actual.length; i++) {
    if (predicted[i] === 1) {
      if (actual[i] === 1) truePositives++;
      else falsePositives++;
    }
  }
  
  return truePositives / (truePositives + falsePositives || 1);
};

const calculateRecall = (actual: number[], predicted: number[]): number => {
  let truePositives = 0;
  let falseNegatives = 0;
  
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === 1) {
      if (predicted[i] === 1) truePositives++;
      else falseNegatives++;
    }
  }
  
  return truePositives / (truePositives + falseNegatives || 1);
};

const calculateF1Score = (actual: number[], predicted: number[]): number => {
  const precision = calculatePrecision(actual, predicted);
  const recall = calculateRecall(actual, predicted);
  
  return 2 * (precision * recall) / (precision + recall || 1);
};

export default {
  trainMLModel,
  predictWithMLModel,
  optimizeMLModel,
  prepareFeatures,
  calculateTechnicalIndicators
};