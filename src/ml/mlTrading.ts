import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
import joblib
import os
from datetime import datetime

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
  // Convert to pandas DataFrame for easier manipulation
  const df = pd.DataFrame(data);
  
  const features: Record<string, number[]> = {};
  
  // Simple Moving Averages
  features.sma5 = df.close.rolling(5).mean().values;
  features.sma10 = df.close.rolling(10).mean().values;
  features.sma20 = df.close.rolling(20).mean().values;
  
  // Exponential Moving Averages
  features.ema5 = df.close.ewm(span=5).mean().values;
  features.ema10 = df.close.ewm(span=10).mean().values;
  features.ema20 = df.close.ewm(span=20).mean().values;
  
  // MACD
  features.macd = features.ema12 - features.ema26;
  features.macd_signal = pd.Series(features.macd).ewm(span=9).mean().values;
  features.macd_hist = features.macd - features.macd_signal;
  
  // RSI (Relative Strength Index)
  const delta = df.close.diff();
  const gain = delta.clip(lower=0);
  const loss = -delta.clip(upper=0);
  const avg_gain = gain.rolling(14).mean();
  const avg_loss = loss.rolling(14).mean();
  const rs = avg_gain / avg_loss;
  features.rsi = 100 - (100 / (1 + rs));
  
  // Bollinger Bands
  features.bb_middle = features.sma20;
  const std20 = df.close.rolling(20).std();
  features.bb_upper = features.bb_middle + (std20 * 2);
  features.bb_lower = features.bb_middle - (std20 * 2);
  
  // Price momentum
  features.momentum5 = df.close / df.close.shift(5) - 1;
  features.momentum10 = df.close / df.close.shift(10) - 1;
  features.momentum20 = df.close / df.close.shift(20) - 1;
  
  // Volatility
  features.volatility5 = df.close.rolling(5).std() / features.sma5;
  features.volatility10 = df.close.rolling(10).std() / features.sma10;
  features.volatility20 = df.close.rolling(20).std() / features.sma20;
  
  // Volume indicators
  features.volume_sma5 = df.volume.rolling(5).mean();
  features.volume_ratio = df.volume / features.volume_sma5;
  
  // Price ratios
  features.close_to_sma5 = df.close / features.sma5;
  features.close_to_sma10 = df.close / features.sma10;
  features.close_to_sma20 = df.close / features.sma20;
  
  // Candle patterns
  features.body_size = (df.close - df.open) / df.open;
  features.upper_shadow = (df.high - np.maximum(df.open, df.close)) / df.open;
  features.lower_shadow = (np.minimum(df.open, df.close) - df.low) / df.open;
  
  return features;
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
  let labels: number[] = [];
  
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
    const [X_train, X_val, y_train, y_val] = train_test_split(features, labels, { test_size: 0.2, random_state: 42 });
    
    // Standardize features
    const scaler = new StandardScaler();
    const X_train_scaled = scaler.fit_transform(X_train);
    const X_val_scaled = scaler.transform(X_val);
    
    // Initialize model based on config
    let model;
    
    switch (config.modelType) {
      case 'randomforest':
        model = new RandomForestClassifier({
          n_estimators: config.hyperParameters?.n_estimators || 100,
          max_depth: config.hyperParameters?.max_depth || 10,
          random_state: 42
        });
        break;
      case 'gradientboosting':
        model = new GradientBoostingClassifier({
          n_estimators: config.hyperParameters?.n_estimators || 100,
          learning_rate: config.hyperParameters?.learning_rate || 0.1,
          max_depth: config.hyperParameters?.max_depth || 3,
          random_state: 42
        });
        break;
      case 'svm':
        model = new SVC({
          C: config.hyperParameters?.C || 1.0,
          kernel: config.hyperParameters?.kernel || 'rbf',
          probability: true,
          random_state: 42
        });
        break;
      case 'neuralnetwork':
        model = new MLPClassifier({
          hidden_layer_sizes: config.hyperParameters?.hidden_layer_sizes || [100, 50],
          activation: config.hyperParameters?.activation || 'relu',
          solver: config.hyperParameters?.solver || 'adam',
          alpha: config.hyperParameters?.alpha || 0.0001,
          max_iter: config.hyperParameters?.max_iter || 200,
          random_state: 42
        });
        break;
      default:
        throw new Error(`Unsupported model type: ${config.modelType}`);
    }
    
    // Train model
    model.fit(X_train_scaled, y_train);
    
    // Evaluate model
    const y_pred = model.predict(X_val_scaled);
    const performance: MLModelPerformance = {
      accuracy: accuracy_score(y_val, y_pred),
      precision: precision_score(y_val, y_pred, { average: 'weighted' }),
      recall: recall_score(y_val, y_pred, { average: 'weighted' }),
      f1Score: f1_score(y_val, y_pred, { average: 'weighted' }),
      trainingSamples: X_train.length,
      validationSamples: X_val.length
    };
    
    // Save model and scaler
    const modelId = `${config.modelType}_${Date.now()}`;
    const modelsDir = './models';
    
    if (!os.path.exists(modelsDir)) {
      os.makedirs(modelsDir);
    }
    
    const modelPath = `${modelsDir}/${modelId}.joblib`;
    const scalerPath = `${modelsDir}/${modelId}_scaler.joblib`;
    
    joblib.dump(model, modelPath);
    joblib.dump(scaler, scalerPath);
    
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
    const modelInfoPath = `${modelsDir}/${modelId}_info.json`;
    fs.writeFileSync(modelInfoPath, JSON.stringify(modelInfo, null, 2));
    
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
    // Load model and scaler
    const model = joblib.load(modelInfo.filePath);
    const scalerPath = modelInfo.filePath.replace('.joblib', '_scaler.joblib');
    const scaler = joblib.load(scalerPath);
    
    // Prepare features
    const { features } = prepareFeatures(data, modelInfo.config);
    
    // Standardize features
    const features_scaled = scaler.transform(features);
    
    // Make predictions
    const predictions_proba = model.predict_proba(features_scaled);
    
    // Create prediction objects
    const result: MLPrediction[] = [];
    
    for (let i = 0; i < data.length; i++) {
      // Skip if features couldn't be calculated for this candle
      if (i >= features.length) continue;
      
      const confidence = predictions_proba[i][1]; // Probability of positive class
      const prediction = confidence > 0.5 ? 1 : 0;
      
      result.push({
        timestamp: data[i].timestamp,
        symbol: data[i].symbol,
        prediction,
        confidence
      });
    }
    
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
    const [X_train, X_val, y_train, y_val] = train_test_split(features, labels, { test_size: 0.2, random_state: 42 });
    
    // Standardize features
    const scaler = new StandardScaler();
    const X_train_scaled = scaler.fit_transform(X_train);
    const X_val_scaled = scaler.transform(X_val);
    
    // Define parameter grid based on model type
    let model, param_grid;
    
    switch (baseConfig.modelType) {
      case 'randomforest':
        model = new RandomForestClassifier({ random_state: 42 });
        param_grid = {
          n_estimators: [50, 100, 200],
          max_depth: [5, 10, 15, null],
          min_samples_split: [2, 5, 10],
          min_samples_leaf: [1, 2, 4]
        };
        break;
      case 'gradientboosting':
        model = new GradientBoostingClassifier({ random_state: 42 });
        param_grid = {
          n_estimators: [50, 100, 200],
          learning_rate: [0.01, 0.1, 0.2],
          max_depth: [3, 5, 7],
          subsample: [0.8, 1.0]
        };
        break;
      case 'svm':
        model = new SVC({ probability: true, random_state: 42 });
        param_grid = {
          C: [0.1, 1, 10],
          kernel: ['linear', 'rbf'],
          gamma: ['scale', 'auto', 0.1, 0.01]
        };
        break;
      case 'neuralnetwork':
        model = new MLPClassifier({ random_state: 42 });
        param_grid = {
          hidden_layer_sizes: [[50], [100], [50, 50], [100, 50]],
          activation: ['relu', 'tanh'],
          alpha: [0.0001, 0.001, 0.01],
          learning_rate: ['constant', 'adaptive']
        };
        break;
      default:
        throw new Error(`Unsupported model type: ${baseConfig.modelType}`);
    }
    
    // Perform grid search
    const grid_search = new GridSearchCV(model, param_grid, {
      cv: 5,
      scoring: 'f1_weighted',
      n_jobs: -1
    });
    
    grid_search.fit(X_train_scaled, y_train);
    
    // Get best parameters
    const best_params = grid_search.best_params_;
    
    // Create optimized config
    const optimizedConfig: MLModelConfig = {
      ...baseConfig,
      hyperParameters: best_params
    };
    
    // Train model with optimized parameters
    return trainMLModel(data, optimizedConfig, modelName);
  } catch (error) {
    console.error('Error optimizing ML model:', error);
    throw error;
  }
};

export default {
  trainMLModel,
  predictWithMLModel,
  optimizeMLModel,
  prepareFeatures,
  calculateTechnicalIndicators
};
