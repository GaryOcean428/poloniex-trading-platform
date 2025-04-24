import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import joblib
import os
import json
from datetime import datetime, timedelta

/**
 * Model Recalibration Module
 * 
 * This module provides functionality for monitoring model performance,
 * detecting drift, and automatically recalibrating ML and DQN models
 * to prevent overfitting and maintain accuracy over time.
 */

// Types for model recalibration
export interface RecalibrationConfig {
  monitoringFrequency: 'hourly' | 'daily' | 'weekly';
  driftThreshold: number;
  autoRecalibrate: boolean;
  performanceMetrics: string[];
  validationSplit: number;
  maxHistoricalModels: number;
  recalibrationStrategy: 'full' | 'incremental' | 'transfer';
}

export interface ModelPerformanceMetrics {
  timestamp: number;
  modelId: string;
  modelType: 'ml' | 'dqn';
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  sharpeRatio?: number;
  sortino?: number;
  maxDrawdown?: number;
  winRate?: number;
  profitFactor?: number;
  expectedValue?: number;
  driftScore?: number;
}

export interface RecalibrationResult {
  originalModelId: string;
  newModelId: string;
  timestamp: number;
  reason: string;
  performanceImprovement: number;
  recalibrationStrategy: string;
}

// Default recalibration configuration
const defaultRecalibrationConfig: RecalibrationConfig = {
  monitoringFrequency: 'daily',
  driftThreshold: 0.15,
  autoRecalibrate: true,
  performanceMetrics: ['accuracy', 'f1Score', 'sharpeRatio', 'winRate'],
  validationSplit: 0.3,
  maxHistoricalModels: 5,
  recalibrationStrategy: 'incremental'
};

/**
 * Calculate drift score between training data distribution and new data
 * @param trainingData Original data used for training
 * @param newData New market data to compare against
 * @returns Drift score between 0 and 1 (higher means more drift)
 */
export const calculateDrift = (trainingData: any[], newData: any[]): number => {
  try {
    // Extract key features for comparison
    const extractFeatures = (data: any[]) => {
      return {
        closePrices: data.map(d => d.close),
        volumes: data.map(d => d.volume),
        highLowRanges: data.map(d => (d.high - d.low) / d.low),
        bodySizes: data.map(d => Math.abs(d.close - d.open) / d.open)
      };
    };
    
    const trainingFeatures = extractFeatures(trainingData);
    const newFeatures = extractFeatures(newData);
    
    // Calculate statistical properties
    const calculateStats = (values: number[]) => {
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      const skewness = values.reduce((sum, val) => sum + Math.pow((val - mean) / Math.sqrt(variance), 3), 0) / values.length;
      const kurtosis = values.reduce((sum, val) => sum + Math.pow((val - mean) / Math.sqrt(variance), 4), 0) / values.length;
      
      return { mean, variance, skewness, kurtosis };
    };
    
    // Calculate stats for each feature
    const trainingStats = {
      closePrices: calculateStats(trainingFeatures.closePrices),
      volumes: calculateStats(trainingFeatures.volumes),
      highLowRanges: calculateStats(trainingFeatures.highLowRanges),
      bodySizes: calculateStats(trainingFeatures.bodySizes)
    };
    
    const newStats = {
      closePrices: calculateStats(newFeatures.closePrices),
      volumes: calculateStats(newFeatures.volumes),
      highLowRanges: calculateStats(newFeatures.highLowRanges),
      bodySizes: calculateStats(newFeatures.bodySizes)
    };
    
    // Calculate normalized differences for each statistical property
    const calculateNormalizedDiff = (val1: number, val2: number) => {
      return Math.abs(val1 - val2) / (Math.abs(val1) + Math.abs(val2) + 1e-8);
    };
    
    // Calculate drift for each feature
    const drifts = [];
    
    for (const feature of ['closePrices', 'volumes', 'highLowRanges', 'bodySizes']) {
      for (const stat of ['mean', 'variance', 'skewness', 'kurtosis']) {
        const diff = calculateNormalizedDiff(
          trainingStats[feature][stat],
          newStats[feature][stat]
        );
        drifts.push(diff);
      }
    }
    
    // Calculate overall drift score (average of all drifts)
    const driftScore = drifts.reduce((sum, val) => sum + val, 0) / drifts.length;
    
    // Normalize to [0, 1] range
    return Math.min(1, Math.max(0, driftScore));
  } catch (error) {
    console.error('Error calculating drift:', error);
    return 0;
  }
};

/**
 * Monitor ML model performance on new data
 * @param modelInfo ML model information
 * @param newData New market data for evaluation
 * @returns Performance metrics
 */
export const monitorMLModelPerformance = async (
  modelInfo: any,
  newData: any[]
): Promise<ModelPerformanceMetrics> => {
  try {
    // Import ML trading functions
    const { prepareFeatures, predictWithMLModel } = await import('./mlTrading');
    
    // Prepare features and labels for evaluation
    const { features, labels } = prepareFeatures(newData, modelInfo.config);
    
    // Get predictions
    const predictions = await predictWithMLModel(modelInfo, newData);
    
    // Calculate performance metrics
    const predictedLabels = predictions.map(p => p.prediction);
    
    // Calculate accuracy
    const correctPredictions = predictedLabels.filter((pred, i) => pred === labels[i]).length;
    const accuracy = correctPredictions / predictedLabels.length;
    
    // Calculate precision, recall, F1 score
    const truePositives = predictedLabels.filter((pred, i) => pred === 1 && labels[i] === 1).length;
    const falsePositives = predictedLabels.filter((pred, i) => pred === 1 && labels[i] === 0).length;
    const falseNegatives = predictedLabels.filter((pred, i) => pred === 0 && labels[i] === 1).length;
    
    const precision = truePositives / (truePositives + falsePositives + 1e-8);
    const recall = truePositives / (truePositives + falseNegatives + 1e-8);
    const f1Score = 2 * (precision * recall) / (precision + recall + 1e-8);
    
    // Calculate win rate
    const winRate = truePositives / (truePositives + falseNegatives + 1e-8);
    
    // Calculate drift score
    const driftScore = calculateDrift(newData.slice(0, 100), newData.slice(-100));
    
    return {
      timestamp: Date.now(),
      modelId: modelInfo.id,
      modelType: 'ml',
      accuracy,
      precision,
      recall,
      f1Score,
      winRate,
      driftScore
    };
  } catch (error) {
    console.error('Error monitoring ML model performance:', error);
    throw error;
  }
};

/**
 * Monitor DQN model performance on new data
 * @param modelInfo DQN model information
 * @param newData New market data for evaluation
 * @returns Performance metrics
 */
export const monitorDQNModelPerformance = async (
  modelInfo: any,
  newData: any[]
): Promise<ModelPerformanceMetrics> => {
  try {
    // Import DQN trading functions
    const { getDQNActions } = await import('./dqnTrading');
    
    // Get actions from model
    const actions = await getDQNActions(modelInfo, newData);
    
    // Simulate trading with these actions
    let balance = 10000;
    let position = 0;
    let trades = [];
    let returns = [];
    
    for (let i = 0; i < actions.length - 1; i++) {
      const action = actions[i];
      const nextAction = actions[i + 1];
      const price = newData[i].close;
      const nextPrice = newData[i + 1].close;
      
      if (action.action === 'buy' && position === 0) {
        // Buy
        position = balance / price;
        balance = 0;
      } else if (action.action === 'sell' && position > 0) {
        // Sell
        balance = position * price;
        const returnPct = (balance - 10000) / 10000;
        returns.push(returnPct);
        trades.push({
          type: 'sell',
          price,
          return: returnPct
        });
        position = 0;
      }
    }
    
    // Calculate performance metrics
    const winningTrades = trades.filter(t => t.return > 0);
    const winRate = winningTrades.length / (trades.length || 1);
    
    // Calculate Sharpe ratio
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / (returns.length || 1);
    const stdReturn = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length || 1)
    );
    const sharpeRatio = meanReturn / (stdReturn + 1e-8);
    
    // Calculate Sortino ratio (downside risk only)
    const negativeReturns = returns.filter(r => r < 0);
    const downsideDeviation = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / (negativeReturns.length || 1)
    );
    const sortino = meanReturn / (downsideDeviation + 1e-8);
    
    // Calculate max drawdown
    let peak = -Infinity;
    let maxDrawdown = 0;
    let cumulativeReturn = 0;
    
    for (const ret of returns) {
      cumulativeReturn += ret;
      if (cumulativeReturn > peak) {
        peak = cumulativeReturn;
      }
      const drawdown = (peak - cumulativeReturn) / (peak + 1e-8);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Calculate profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.return, 0);
    const grossLoss = Math.abs(trades.filter(t => t.return < 0).reduce((sum, t) => sum + t.return, 0));
    const profitFactor = grossProfit / (grossLoss + 1e-8);
    
    // Calculate expected value
    const expectedValue = meanReturn * trades.length;
    
    // Calculate drift score
    const driftScore = calculateDrift(newData.slice(0, 100), newData.slice(-100));
    
    return {
      timestamp: Date.now(),
      modelId: modelInfo.id,
      modelType: 'dqn',
      sharpeRatio,
      sortino,
      maxDrawdown,
      winRate,
      profitFactor,
      expectedValue,
      driftScore
    };
  } catch (error) {
    console.error('Error monitoring DQN model performance:', error);
    throw error;
  }
};

/**
 * Recalibrate ML model with new data
 * @param modelInfo Original ML model information
 * @param newData New market data for recalibration
 * @param strategy Recalibration strategy
 * @returns Recalibration result with new model info
 */
export const recalibrateMLModel = async (
  modelInfo: any,
  newData: any[],
  strategy: 'full' | 'incremental' | 'transfer' = 'incremental'
): Promise<RecalibrationResult> => {
  try {
    // Import ML trading functions
    const { trainMLModel, optimizeMLModel } = await import('./mlTrading');
    
    let newModelInfo;
    let recalibrationStrategy = strategy;
    
    switch (strategy) {
      case 'full':
        // Full retraining from scratch
        newModelInfo = await trainMLModel(
          newData,
          modelInfo.config,
          `${modelInfo.name} (Recalibrated)`
        );
        break;
        
      case 'incremental':
        // Incremental training with new data
        // First, load the existing model
        const existingModel = await joblib.load(modelInfo.filePath);
        const existingScaler = await joblib.load(modelInfo.filePath.replace('.joblib', '_scaler.joblib'));
        
        // Prepare new data
        const { prepareFeatures } = await import('./mlTrading');
        const { features, labels } = prepareFeatures(newData, modelInfo.config);
        
        // Scale features
        const scaledFeatures = existingScaler.transform(features);
        
        // Incrementally train the model
        await existingModel.fit(scaledFeatures, labels, {
          epochs: 5,
          verbose: 0
        });
        
        // Save updated model
        const newModelId = `${modelInfo.id}_recal_${Date.now()}`;
        const modelsDir = './models';
        const newModelPath = `${modelsDir}/${newModelId}.joblib`;
        
        await joblib.dump(existingModel, newModelPath);
        await joblib.dump(existingScaler, newModelPath.replace('.joblib', '_scaler.joblib'));
        
        // Create new model info
        newModelInfo = {
          ...modelInfo,
          id: newModelId,
          name: `${modelInfo.name} (Recalibrated)`,
          filePath: newModelPath,
          updatedAt: Date.now(),
          lastTrainedAt: Date.now()
        };
        break;
        
      case 'transfer':
        // Transfer learning: optimize hyperparameters with new data
        newModelInfo = await optimizeMLModel(
          newData,
          modelInfo.config,
          `${modelInfo.name} (Transfer Recalibrated)`
        );
        break;
        
      default:
        throw new Error(`Unsupported recalibration strategy: ${strategy}`);
    }
    
    // Calculate performance improvement
    const originalPerformance = await monitorMLModelPerformance(modelInfo, newData);
    const newPerformance = await monitorMLModelPerformance(newModelInfo, newData);
    
    // Use F1 score for performance comparison
    const performanceImprovement = (newPerformance.f1Score - originalPerformance.f1Score) / 
                                  (originalPerformance.f1Score + 1e-8);
    
    return {
      originalModelId: modelInfo.id,
      newModelId: newModelInfo.id,
      timestamp: Date.now(),
      reason: `Drift score: ${originalPerformance.driftScore.toFixed(4)}, F1 score: ${originalPerformance.f1Score.toFixed(4)}`,
      performanceImprovement,
      recalibrationStrategy
    };
  } catch (error) {
    console.error('Error recalibrating ML model:', error);
    throw error;
  }
};

/**
 * Recalibrate DQN model with new data
 * @param modelInfo Original DQN model information
 * @param newData New market data for recalibration
 * @param strategy Recalibration strategy
 * @returns Recalibration result with new model info
 */
export const recalibrateDQNModel = async (
  modelInfo: any,
  newData: any[],
  strategy: 'full' | 'incremental' | 'transfer' = 'incremental'
): Promise<RecalibrationResult> => {
  try {
    // Import DQN trading functions
    const { trainDQNModel, continueDQNTraining } = await import('./dqnTrading');
    
    let newModelInfo;
    let recalibrationStrategy = strategy;
    
    switch (strategy) {
      case 'full':
        // Full retraining from scratch
        newModelInfo = await trainDQNModel(
          newData,
          modelInfo.config,
          `${modelInfo.name} (Recalibrated)`,
          100 // Default episodes
        );
        break;
        
      case 'incremental':
        // Incremental training with new data
        newModelInfo = await continueDQNTraining(
          modelInfo,
          newData,
          50 // Default additional episodes
        );
        break;
        
      case 'transfer':
        // Transfer learning: adjust learning rate and train
        const transferConfig = {
          ...modelInfo.config,
          learningRate: modelInfo.config.learningRate * 0.5, // Reduce learning rate
          epsilonStart: 0.5, // Start with lower exploration
          epsilonDecay: 0.99 // Slower decay
        };
        
        newModelInfo = await trainDQNModel(
          newData,
          transferConfig,
          `${modelInfo.name} (Transfer Recalibrated)`,
          75 // Default episodes
        );
        break;
        
      default:
        throw new Error(`Unsupported recalibration strategy: ${strategy}`);
    }
    
    // Calculate performance improvement
    const originalPerformance = await monitorDQNModelPerformance(modelInfo, newData);
    const newPerformance = await monitorDQNModelPerformance(newModelInfo, newData);
    
    // Use Sharpe ratio for performance comparison
    const performanceImprovement = (newPerformance.sharpeRatio - originalPerformance.sharpeRatio) / 
                                  (Math.abs(originalPerformance.sharpeRatio) + 1e-8);
    
    return {
      originalModelId: modelInfo.id,
      newModelId: newModelInfo.id,
      timestamp: Date.now(),
      reason: `Drift score: ${originalPerformance.driftScore.toFixed(4)}, Sharpe ratio: ${originalPerformance.sharpeRatio.toFixed(4)}`,
      performanceImprovement,
      recalibrationStrategy
    };
  } catch (error) {
    console.error('Error recalibrating DQN model:', error);
    throw error;
  }
};

/**
 * Automatically monitor and recalibrate models based on performance
 * @param modelInfo Model information (ML or DQN)
 * @param newData New market data for evaluation and recalibration
 * @param config Recalibration configuration
 * @returns Recalibration result if performed, null otherwise
 */
export const autoRecalibrate = async (
  modelInfo: any,
  newData: any[],
  config: RecalibrationConfig = defaultRecalibrationConfig
): Promise<RecalibrationResult | null> => {
  try {
    // Monitor performance
    let performance;
    
    if (modelInfo.config.modelType) {
      // ML model
      performance = await monitorMLModelPerformance(modelInfo, newData);
    } else {
      // DQN model
      performance = await monitorDQNModelPerformance(modelInfo, newData);
    }
    
    // Check if recalibration is needed
    const needsRecalibration = performance.driftScore > config.driftThreshold;
    
    if (needsRecalibration && config.autoRecalibrate) {
      console.log(`Recalibrating model ${modelInfo.id} due to drift score ${performance.driftScore.toFixed(4)}`);
      
      // Choose recalibration strategy based on drift score
      let strategy: 'full' | 'incremental' | 'transfer';
      
      if (performance.driftScore > 0.5) {
        strategy = 'full'; // Major drift, full retraining
      } else if (performance.driftScore > 0.3) {
        strategy = 'transfer'; // Moderate drift, transfer learning
      } else {
        strategy = 'incremental'; // Minor drift, incremental training
      }
      
      // Perform recalibration
      if (modelInfo.config.modelType) {
        // ML model
        return await recalibrateMLModel(modelInfo, newData, strategy);
      } else {
        // DQN model
        return await recalibrateDQNModel(modelInfo, newData, strategy);
      }
    }
    
    return null; // No recalibration needed or performed
  } catch (error) {
    console.error('Error in auto recalibration:', error);
    return null;
  }
};

/**
 * Schedule regular model monitoring and recalibration
 * @param modelInfo Model information (ML or DQN)
 * @param getNewData Function to fetch new market data
 * @param config Recalibration configuration
 * @returns Cleanup function to stop scheduling
 */
export const scheduleRecalibration = (
  modelInfo: any,
  getNewData: () => Promise<any[]>,
  config: RecalibrationConfig = defaultRecalibrationConfig
): () => void => {
  let intervalId: any;
  
  const performCheck = async () => {
    try {
      // Get new data
      const newData = await getNewData();
      
      // Perform auto recalibration
      const result = await autoRecalibrate(modelInfo, newData, config);
      
      // Log result
      if (result) {
        console.log(`Model ${modelInfo.id} recalibrated:`, result);
      } else {
        console.log(`Model ${modelInfo.id} checked, no recalibration needed`);
      }
    } catch (error) {
      console.error('Error in scheduled recalibration:', error);
    }
  };
  
  // Determine interval based on frequency
  let interval: number;
  switch (config.monitoringFrequency) {
    case 'hourly':
      interval = 60 * 60 * 1000; // 1 hour
      break;
    case 'weekly':
      interval = 7 * 24 * 60 * 60 * 1000; // 1 week
      break;
    case 'daily':
    default:
      interval = 24 * 60 * 60 * 1000; // 1 day
      break;
  }
  
  // Schedule regular checks
  intervalId = setInterval(performCheck, interval);
  
  // Perform initial check
  performCheck();
  
  // Return cleanup function
  return () => {
    clearInterval(intervalId);
  };
};

export default {
  calculateDrift,
  monitorMLModelPerformance,
  monitorDQNModelPerformance,
  recalibrateMLModel,
  recalibrateDQNModel,
  autoRecalibrate,
  scheduleRecalibration
};
