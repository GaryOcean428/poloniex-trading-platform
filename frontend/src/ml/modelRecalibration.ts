import * as tf from '@tensorflow/tfjs';

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
  newPerformanceMetrics?: ModelPerformanceMetrics & { overallScore?: number };
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
    const drifts: number[] = [];
    
    for (const feature of ['closePrices', 'volumes', 'highLowRanges', 'bodySizes'] as const) {
      for (const stat of ['mean', 'variance', 'skewness', 'kurtosis'] as const) {
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
    const trades: Array<{type: string, price: number, return: number}> = [];
    const returns: number[] = [];
    
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
    const recalibrationStrategy = strategy;
    
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
        const model = await tf.loadLayersModel(`file://${modelInfo.filePath}/model.json`);
        
        // Prepare new data
        const { prepareFeatures } = await import('./mlTrading');
        const { features, labels } = prepareFeatures(newData, modelInfo.config);
        
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
          const { calculateMeanAndStd } = await import('./mlTrading');
          const result = calculateMeanAndStd(features);
          mean = result.mean;
          std = result.std;
        }
        
        // Standardize features
        const { standardizeFeatures } = await import('./mlTrading');
        const features_scaled = standardizeFeatures(features, mean, std);
        
        // Convert to tensors
        const xs = tf.tensor2d(features_scaled);
        const ys = tf.tensor1d(labels);
        
        // Incrementally train the model
        await model.fit(xs, ys, {
          epochs: 5,
          verbose: 0
        });
        
        // Save updated model
        const newModelId = `${modelInfo.id}_recal_${Date.now()}`;
        const modelsDir = './models';
        const newModelPath = `${modelsDir}/${newModelId}`;
        
        await model.save(`file://${newModelPath}`);
        
        // Save stats
        try {
          // Dynamic import for Node.js environments only
          if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const fs = await import('fs');
            fs.writeFileSync(`${newModelPath}/stats.json`, JSON.stringify({ mean, std }));
          }
        } catch (error) {
          console.error('Error saving model stats:', error);
        }
        
        // Create new model info
        newModelInfo = {
          ...modelInfo,
          id: newModelId,
          name: `${modelInfo.name} (Recalibrated)`,
          filePath: newModelPath,
          updatedAt: Date.now(),
          lastTrainedAt: Date.now()
        };
        
        // Clean up tensors
        xs.dispose();
        ys.dispose();
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
    const performanceImprovement = (newPerformance.f1Score! - originalPerformance.f1Score!) / 
                                  (originalPerformance.f1Score! + 1e-8);
    
    return {
      originalModelId: modelInfo.id,
      newModelId: newModelInfo.id,
      timestamp: Date.now(),
      reason: `Drift score: ${originalPerformance.driftScore!.toFixed(4)}, F1 score: ${originalPerformance.f1Score!.toFixed(4)}`,
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
    const recalibrationStrategy = strategy;
    
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
    const performanceImprovement = (newPerformance.sharpeRatio! - originalPerformance.sharpeRatio!) / 
                                  (Math.abs(originalPerformance.sharpeRatio!) + 1e-8);
    
    return {
      originalModelId: modelInfo.id,
      newModelId: newModelInfo.id,
      timestamp: Date.now(),
      reason: `Drift score: ${originalPerformance.driftScore!.toFixed(4)}, Sharpe ratio: ${originalPerformance.sharpeRatio!.toFixed(4)}`,
      performanceImprovement,
      recalibrationStrategy
    };
  } catch (error) {
    console.error('Error recalibrating DQN model:', error);
    throw error;
  }
};

/**
 * Schedule model recalibration based on performance monitoring
 * @param modelInfo Model information (ML or DQN)
 * @param config Recalibration configuration
 * @param newData New market data for evaluation and recalibration
 * @returns Recalibration result if performed, null otherwise
 */
export const scheduleModelRecalibration = async (
  modelInfo: any,
  config: Partial<RecalibrationConfig> = {},
  newData: any[]
): Promise<RecalibrationResult | null> => {
  try {
    // Merge with default config
    const fullConfig: RecalibrationConfig = { ...defaultRecalibrationConfig, ...config };
    
    // Monitor model performance
    let performance: ModelPerformanceMetrics;
    
    if (modelInfo.modelType === 'ml' || modelInfo.config.modelType) {
      performance = await monitorMLModelPerformance(modelInfo, newData);
    } else {
      performance = await monitorDQNModelPerformance(modelInfo, newData);
    }
    
    // Check if recalibration is needed
    let needsRecalibration = false;
    let recalibrationReason = '';
    
    // Check drift threshold
    if (performance.driftScore! > fullConfig.driftThreshold) {
      needsRecalibration = true;
      recalibrationReason = `Drift score ${performance.driftScore!.toFixed(4)} exceeds threshold ${fullConfig.driftThreshold}`;
    }
    
    // Check performance metrics
    if (performance.modelType === 'ml') {
      if (performance.accuracy! < 0.55) {
        needsRecalibration = true;
        recalibrationReason += ` Accuracy ${performance.accuracy!.toFixed(4)} below threshold`;
      }
      if (performance.f1Score! < 0.5) {
        needsRecalibration = true;
        recalibrationReason += ` F1 score ${performance.f1Score!.toFixed(4)} below threshold`;
      }
    } else {
      if (performance.sharpeRatio! < 0.2) {
        needsRecalibration = true;
        recalibrationReason += ` Sharpe ratio ${performance.sharpeRatio!.toFixed(4)} below threshold`;
      }
      if (performance.winRate! < 0.45) {
        needsRecalibration = true;
        recalibrationReason += ` Win rate ${performance.winRate!.toFixed(4)} below threshold`;
      }
    }
    
    // Perform recalibration if needed and auto-recalibrate is enabled
    if (needsRecalibration && fullConfig.autoRecalibrate) {
      console.log(`Recalibrating model ${modelInfo.id}: ${recalibrationReason}`);
      
      if (performance.modelType === 'ml') {
        return await recalibrateMLModel(modelInfo, newData, fullConfig.recalibrationStrategy);
      } else {
        return await recalibrateDQNModel(modelInfo, newData, fullConfig.recalibrationStrategy);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error scheduling model recalibration:', error);
    return null;
  }
};

/**
 * Evaluate model performance and recalibration history
 * @param modelId Model ID to evaluate
 * @param historyLength Number of historical performance records to analyze
 * @returns Analysis of model performance trends
 */
export const evaluateModelHistory = async (
  modelId: string,
  historyLength: number = 10
): Promise<{
  modelId: string;
  performanceTrend: 'improving' | 'stable' | 'degrading';
  driftTrend: 'increasing' | 'stable' | 'decreasing';
  recalibrationFrequency: number;
  recommendedAction: 'none' | 'monitor' | 'recalibrate' | 'replace';
}> => {
  try {
    // Load performance history
    // Dynamic import for Node.js environments only
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const fs = await import('fs');
      const modelsDir = './models';
      const historyPath = `${modelsDir}/${modelId}_history.json`;
    
      let performanceHistory: ModelPerformanceMetrics[] = [];
      
      if (fs.existsSync(historyPath)) {
        performanceHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      }
      
      // Limit to requested history length
      performanceHistory = performanceHistory.slice(-historyLength);
      
      if (performanceHistory.length < 2) {
        return {
          modelId,
          performanceTrend: 'stable',
          driftTrend: 'stable',
          recalibrationFrequency: 0,
          recommendedAction: 'monitor'
        };
      }
      
      // Calculate trends and analysis...
      // This would contain the actual trend analysis logic in a complete implementation
      const latestMetrics = performanceHistory[performanceHistory.length - 1];
      const earliestMetrics = performanceHistory[0];
      
      // Simple trend calculation based on accuracy change
      const accuracyChange = latestMetrics.accuracy - earliestMetrics.accuracy;
      const performanceTrend = accuracyChange > 0.01 ? 'improving' : 
                              accuracyChange < -0.01 ? 'degrading' : 'stable';
      
      // Simple drift calculation based on precision change  
      const precisionChange = latestMetrics.precision - earliestMetrics.precision;
      const driftTrend = Math.abs(precisionChange) > 0.01 ? 'increasing' : 'stable';
      
      return {
        modelId,
        performanceTrend,
        driftTrend,
        recalibrationFrequency: performanceHistory.length,
        recommendedAction: performanceTrend === 'degrading' ? 'recalibrate' : 'monitor'
      };
    } else {
      // Browser environment - return default analysis
      return {
        modelId,
        performanceTrend: 'stable',
        driftTrend: 'stable',
        recalibrationFrequency: 0,
        recommendedAction: 'monitor'
      };
    }
  } catch (error) {
    console.error('Error evaluating model history:', error);
    return {
      modelId,
      performanceTrend: 'stable',
      driftTrend: 'stable',
      recalibrationFrequency: 0,
      recommendedAction: 'monitor'
    };
  }
};

// Helper function to calculate trend
const calculateTrend = (values: number[], inverse: boolean = false): 'improving' | 'stable' | 'degrading' => {
  if (values.length < 2) return 'stable';
  
  // Calculate linear regression slope
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = values;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumXX = x.reduce((a, b) => a + b * b, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  
  // Determine trend based on slope
  const threshold = 0.01; // Minimum slope to consider a trend
  
  if (Math.abs(slope) < threshold) {
    return 'stable';
  }
  
  if (inverse) {
    return slope > 0 ? 'degrading' : 'improving';
  } else {
    return slope > 0 ? 'improving' : 'degrading';
  }
};

// Helper function to calculate recalibration frequency
const calculateRecalibrationFrequency = (history: RecalibrationResult[]): number => {
  if (history.length < 2) return 0;
  
  // Get time range in months
  const firstRecal = history[0].timestamp;
  const lastRecal = history[history.length - 1].timestamp;
  const monthsDiff = (lastRecal - firstRecal) / (1000 * 60 * 60 * 24 * 30);
  
  return history.length / Math.max(1, monthsDiff);
};

export default {
  calculateDrift,
  monitorMLModelPerformance,
  monitorDQNModelPerformance,
  recalibrateMLModel,
  recalibrateDQNModel,
  scheduleModelRecalibration,
  evaluateModelHistory
};