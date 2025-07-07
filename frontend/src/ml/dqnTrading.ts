import * as tf from '@tensorflow/tfjs';

/**
 * Deep Q-Network (DQN) Trading System
 * 
 * This module implements a reinforcement learning based trading system using Deep Q-Networks.
 * It includes environment simulation, model training, experience replay, and trading execution.
 */

// Types for DQN trading
export interface DQNConfig {
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

export interface DQNModelInfo {
  id: string;
  name: string;
  description: string;
  config: DQNConfig;
  performance: DQNPerformance;
  createdAt: number;
  updatedAt: number;
  lastTrainedAt: number;
  status: 'training' | 'ready' | 'error';
  filePath?: string;
  episodesCompleted: number;
  totalTrainingSteps: number;
}

export interface DQNPerformance {
  averageReward: number;
  cumulativeReward: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  episodeRewards: number[];
  trainingEpisodes: number;
}

export interface DQNAction {
  timestamp: number;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  position?: number;
  price?: number;
}

// Default DQN configuration
const defaultDQNConfig: DQNConfig = {
  stateDimension: 30,  // Number of features in state
  actionDimension: 3,  // Buy, Sell, Hold
  learningRate: 0.0001,
  gamma: 0.99,         // Discount factor
  epsilonStart: 1.0,   // Initial exploration rate
  epsilonEnd: 0.01,    // Final exploration rate
  epsilonDecay: 0.995, // Exploration decay rate
  memorySize: 10000,   // Experience replay buffer size
  batchSize: 64,       // Training batch size
  updateTargetFreq: 100, // Target network update frequency
  hiddenLayers: [128, 64], // Hidden layer sizes
  activationFunction: 'relu',
  optimizer: 'adam'
};

// DQN Agent class
class DQNAgent {
  private config: DQNConfig;
  private mainModel: tf.LayersModel;
  private targetModel: tf.LayersModel;
  private memory: Array<[number[], number, number, number[], boolean]>;
  private epsilon: number;
  private step: number;
  
  constructor(config: DQNConfig) {
    this.config = config;
    this.mainModel = this.createModel();
    this.targetModel = this.createModel();
    this.updateTargetModel();
    this.memory = [];
    this.epsilon = config.epsilonStart;
    this.step = 0;
  }
  
  // Create neural network model
  private createModel(): tf.LayersModel {
    const model = tf.sequential();
    
    // Input layer
    model.add(tf.layers.dense({
      units: this.config.hiddenLayers[0],
      activation: this.config.activationFunction as any,
      inputShape: [this.config.stateDimension]
    }));
    
    // Hidden layers
    for (let i = 1; i < this.config.hiddenLayers.length; i++) {
      model.add(tf.layers.dense({
        units: this.config.hiddenLayers[i],
        activation: this.config.activationFunction as any
      }));
    }
    
    // Output layer
    model.add(tf.layers.dense({
      units: this.config.actionDimension,
      activation: 'linear'
    }));
    
    // Compile model
    model.compile({
      optimizer: this.config.optimizer === 'adam' ? tf.train.adam(this.config.learningRate) : tf.train.sgd(this.config.learningRate),
      loss: 'meanSquaredError'
    });
    
    return model;
  }
  
  // Update target model with weights from main model
  private updateTargetModel(): void {
    const weights = this.mainModel.getWeights();
    this.targetModel.setWeights(weights);
  }
  
  // Remember experience for replay
  remember(state: number[], action: number, reward: number, nextState: number[], done: boolean): void {
    this.memory.push([state, action, reward, nextState, done]);
    if (this.memory.length > this.config.memorySize) {
      this.memory.shift();
    }
  }
  
  // Choose action using epsilon-greedy policy
  chooseAction(state: number[]): number {
    if (Math.random() < this.epsilon) {
      // Exploration: random action
      return Math.floor(Math.random() * this.config.actionDimension);
    } else {
      // Exploitation: best action according to model
      return tf.tidy(() => {
        const stateTensor = tf.tensor2d([state]);
        const prediction = this.mainModel.predict(stateTensor) as tf.Tensor;
        const action = tf.argMax(prediction, 1).dataSync()[0];
        return action;
      });
    }
  }
  
  // Get action confidence
  getActionConfidence(state: number[], action: number): number {
    return tf.tidy(() => {
      const stateTensor = tf.tensor2d([state]);
      const prediction = this.mainModel.predict(stateTensor) as tf.Tensor;
      const qValues = prediction.dataSync();
      const maxQ = Math.max(...qValues);
      const actionQ = qValues[action];
      
      // Normalize to [0, 1] range
      return actionQ / (maxQ + 1e-8);
    });
  }
  
  // Train model with experience replay
  async replay(): Promise<void> {
    if (this.memory.length < this.config.batchSize) {
      return;
    }
    
    // Sample batch from memory
    const batch = this.sampleBatch();
    
    // Extract batch components
    const states = batch.map(experience => experience[0]);
    const actions = batch.map(experience => experience[1]);
    const rewards = batch.map(experience => experience[2]);
    const nextStates = batch.map(experience => experience[3]);
    const dones = batch.map(experience => experience[4]);
    
    // Train the model
    await tf.tidy(() => {
      // Convert to tensors
      const statesTensor = tf.tensor2d(states);
      const nextStatesTensor = tf.tensor2d(nextStates);
      
      // Get current Q values
      const currentQs = this.mainModel.predict(statesTensor) as tf.Tensor;
      const currentQsArray = currentQs.arraySync() as number[][];
      
      // Get next Q values from target model
      const nextQs = this.targetModel.predict(nextStatesTensor) as tf.Tensor;
      const nextQsArray = nextQs.arraySync() as number[][];
      
      // Create target Q values by updating only the chosen actions
      const targetQsArray = [...currentQsArray];
      
      for (let i = 0; i < batch.length; i++) {
        const action = actions[i];
        const reward = rewards[i];
        const done = dones[i];
        
        let targetQ;
        if (done) {
          targetQ = reward;
        } else {
          const nextQ = nextQsArray[i];
          const maxNextQ = Math.max(...nextQ);
          targetQ = reward + this.config.gamma * maxNextQ;
        }
        
        targetQsArray[i][action] = targetQ;
      }
      
      const targetQsTensor = tf.tensor2d(targetQsArray);
      
      // Train the model
      return this.mainModel.fit(statesTensor, targetQsTensor, {
        epochs: 1,
        verbose: 0
      });
    });
    
    // Update epsilon (exploration rate)
    if (this.epsilon > this.config.epsilonEnd) {
      this.epsilon *= this.config.epsilonDecay;
    }
    
    // Update target model periodically
    this.step++;
    if (this.step % this.config.updateTargetFreq === 0) {
      this.updateTargetModel();
    }
  }
  
  // Sample batch from memory
  private sampleBatch(): Array<[number[], number, number, number[], boolean]> {
    const indices: number[] = [];
    const batchSize = Math.min(this.config.batchSize, this.memory.length);
    
    while (indices.length < batchSize) {
      const index = Math.floor(Math.random() * this.memory.length);
      if (!indices.includes(index)) {
        indices.push(index);
      }
    }
    
    return indices.map(index => this.memory[index]);
  }
  
  // Save model
  async saveModel(path: string): Promise<void> {
    await this.mainModel.save(`file://${path}`);
  }
  
  // Load model
  async loadModel(path: string): Promise<void> {
    this.mainModel = await tf.loadLayersModel(`file://${path}/model.json`);
    this.targetModel = await tf.loadLayersModel(`file://${path}/model.json`);
  }
}

// Trading environment class
class TradingEnvironment {
  private data: any[];
  private currentStep: number;
  private position: number;
  private initialBalance: number;
  private balance: number;
  private inventory: number[];
  private rewards: number[];
  private done: boolean;
  private stateDimension: number;
  private transactionCost: number;
  
  constructor(data: any[], initialBalance: number = 10000, transactionCost: number = 0.001) {
    this.data = data;
    this.initialBalance = initialBalance;
    this.transactionCost = transactionCost;
    this.stateDimension = 30; // Default state dimension
    this.reset();
  }
  
  reset(): number[] {
    this.currentStep = 0;
    this.position = 0; // 0: no position, 1: long position
    this.balance = this.initialBalance;
    this.inventory = [];
    this.rewards = [];
    this.done = false;
    return this.getState();
  }
  
  getState(): number[] {
    // If we've reached the end of data
    if (this.currentStep >= this.data.length - 1) {
      this.done = true;
      return new Array(this.stateDimension).fill(0);
    }
    
    // Get current candle and previous candles
    const currentCandle = this.data[this.currentStep];
    const lookback = 10; // Use 10 previous candles for state
    const historyStart = Math.max(0, this.currentStep - lookback);
    const priceHistory = this.data.slice(historyStart, this.currentStep + 1);
    
    // Extract features
    const state: number[] = [];
    
    // Position indicator
    state.push(this.position);
    
    // Price features
    const currentPrice = currentCandle.close;
    const normalizedPrices = priceHistory.map(candle => candle.close / currentPrice - 1);
    state.push(...normalizedPrices);
    
    // Volume features
    const avgVolume = priceHistory.reduce((sum, candle) => sum + candle.volume, 0) / priceHistory.length;
    const normalizedVolumes = priceHistory.map(candle => candle.volume / avgVolume);
    state.push(...normalizedVolumes);
    
    // Candlestick features
    const bodySizes = priceHistory.map(candle => Math.abs(candle.close - candle.open) / candle.open);
    state.push(...bodySizes);
    
    // Pad state to fixed dimension if needed
    while (state.length < this.stateDimension) {
      state.push(0);
    }
    
    // Truncate if too long
    return state.slice(0, this.stateDimension);
  }
  
  step(action: number): [number[], number, boolean] {
    // If already done, return terminal state
    if (this.done) {
      return [new Array(this.stateDimension).fill(0), 0, true];
    }
    
    // Get current price
    const currentPrice = this.data[this.currentStep].close;
    let reward = 0;
    
    // Execute action
    if (action === 0) { // Buy
      if (this.position === 0) { // Only buy if no position
        const sharesBought = Math.floor(this.balance / currentPrice);
        const cost = sharesBought * currentPrice * (1 + this.transactionCost);
        
        if (sharesBought > 0) {
          this.balance -= cost;
          this.inventory.push(currentPrice);
          this.position = 1;
          reward = -this.transactionCost * cost; // Small negative reward for transaction cost
        } else {
          reward = -0.1; // Penalty for invalid action
        }
      } else {
        reward = -0.1; // Penalty for invalid action
      }
    } else if (action === 1) { // Sell
      if (this.position === 1) { // Only sell if has position
        const sharesSold = this.inventory.length;
        const revenue = sharesSold * currentPrice * (1 - this.transactionCost);
        
        if (sharesSold > 0) {
          this.balance += revenue;
          const avgBuyPrice = this.inventory.reduce((sum, price) => sum + price, 0) / sharesSold;
          reward = (currentPrice - avgBuyPrice) / avgBuyPrice; // Reward based on profit percentage
          this.inventory = [];
          this.position = 0;
        } else {
          reward = -0.1; // Penalty for invalid action
        }
      } else {
        reward = -0.1; // Penalty for invalid action
      }
    } else { // Hold
      if (this.position === 1) {
        // Small reward/penalty based on price movement while holding
        const prevPrice = this.data[Math.max(0, this.currentStep - 1)].close;
        reward = (currentPrice - prevPrice) / prevPrice * 0.1;
      } else {
        reward = 0; // Neutral reward for holding cash
      }
    }
    
    // Move to next step
    this.currentStep++;
    this.rewards.push(reward);
    
    // Check if episode is done
    if (this.currentStep >= this.data.length - 1) {
      this.done = true;
      
      // Add final portfolio value to reward
      const finalPortfolioValue = this.balance + (this.inventory.length * this.data[this.currentStep].close);
      const totalReturn = (finalPortfolioValue - this.initialBalance) / this.initialBalance;
      reward += totalReturn;
    }
    
    return [this.getState(), reward, this.done];
  }
  
  getPerformance(): {
    totalReturn: number;
    finalValue: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    cumulativeReward: number;
  } {
    const finalPortfolioValue = this.balance + (this.inventory.length * this.data[this.currentStep].close);
    const totalReturn = (finalPortfolioValue - this.initialBalance) / this.initialBalance;
    
    // Calculate Sharpe ratio
    const returns = this.rewards.filter(r => r !== 0);
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length);
    const sharpeRatio = meanReturn / (stdReturn + 1e-8);
    
    // Calculate max drawdown
    let peak = -Infinity;
    let maxDrawdown = 0;
    let cumulativeReward = 0;
    
    for (const reward of this.rewards) {
      cumulativeReward += reward;
      if (cumulativeReward > peak) {
        peak = cumulativeReward;
      }
      const drawdown = (peak - cumulativeReward) / (peak + 1e-8);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Calculate win rate
    const trades = this.rewards.filter(r => r !== 0);
    const winningTrades = trades.filter(r => r > 0);
    const winRate = winningTrades.length / (trades.length + 1e-8);
    
    return {
      totalReturn,
      finalValue: finalPortfolioValue,
      sharpeRatio,
      maxDrawdown,
      winRate,
      cumulativeReward
    };
  }
}

// Train DQN model
export const trainDQNModel = async (
  data: any[],
  config: Partial<DQNConfig> = {},
  modelName: string = 'DQN Trading Model',
  episodes: number = 100
): Promise<DQNModelInfo> => {
  try {
    // Merge with default config
    const fullConfig: DQNConfig = { ...defaultDQNConfig, ...config };
    
    // Create environment and agent
    const env = new TradingEnvironment(data);
    const agent = new DQNAgent(fullConfig);
    
    // Training variables
    const episodeRewards: number[] = [];
    let totalSteps = 0;
    
    // Train for specified number of episodes
    for (let episode = 0; episode < episodes; episode++) {
      let state = env.reset();
      let done = false;
      let episodeReward = 0;
      
      // Episode loop
      while (!done) {
        // Choose action
        const action = agent.chooseAction(state);
        
        // Take action
        const [nextState, reward, isDone] = env.step(action);
        
        // Remember experience
        agent.remember(state, action, reward, nextState, isDone);
        
        // Train model
        await agent.replay();
        
        // Update state and counters
        state = nextState;
        done = isDone;
        episodeReward += reward;
        totalSteps++;
      }
      
      // Record episode results
      episodeRewards.push(episodeReward);
      
      // Log progress
      if ((episode + 1) % 10 === 0) {
        const avgReward = episodeRewards.slice(-10).reduce((sum, r) => sum + r, 0) / 10;
        console.log(`Episode ${episode + 1}/${episodes}, Avg Reward: ${avgReward.toFixed(2)}`);
      }
    }
    
    // Get performance metrics
    const performance = env.getPerformance();
    
    // Save model
    const modelId = `dqn_${Date.now()}`;
    const modelsDir = './models';
    
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
    
    const modelPath = `${modelsDir}/${modelId}`;
    await agent.saveModel(modelPath);
    
    // Create model info
    const modelInfo: DQNModelInfo = {
      id: modelId,
      name: modelName,
      description: `DQN trading model trained on ${data.length} candles`,
      config: fullConfig,
      performance: {
        averageReward: episodeRewards.reduce((sum, r) => sum + r, 0) / episodes,
        cumulativeReward: performance.cumulativeReward,
        sharpeRatio: performance.sharpeRatio,
        maxDrawdown: performance.maxDrawdown,
        winRate: performance.winRate,
        episodeRewards,
        trainingEpisodes: episodes
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTrainedAt: Date.now(),
      status: 'ready',
      filePath: modelPath,
      episodesCompleted: episodes,
      totalTrainingSteps: totalSteps
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
    
    return modelInfo;
  } catch (error) {
    console.error('Error training DQN model:', error);
    throw error;
  }
};

// Continue training an existing DQN model
export const continueDQNTraining = async (
  modelInfo: DQNModelInfo,
  data: any[],
  additionalEpisodes: number = 50
): Promise<DQNModelInfo> => {
  try {
    // Create environment and agent
    const env = new TradingEnvironment(data);
    const agent = new DQNAgent(modelInfo.config);
    
    // Load existing model
    await agent.loadModel(modelInfo.filePath as string);
    
    // Training variables
    const episodeRewards: number[] = [];
    let totalSteps = modelInfo.totalTrainingSteps;
    
    // Train for additional episodes
    for (let episode = 0; episode < additionalEpisodes; episode++) {
      let state = env.reset();
      let done = false;
      let episodeReward = 0;
      
      // Episode loop
      while (!done) {
        // Choose action
        const action = agent.chooseAction(state);
        
        // Take action
        const [nextState, reward, isDone] = env.step(action);
        
        // Remember experience
        agent.remember(state, action, reward, nextState, isDone);
        
        // Train model
        await agent.replay();
        
        // Update state and counters
        state = nextState;
        done = isDone;
        episodeReward += reward;
        totalSteps++;
      }
      
      // Record episode results
      episodeRewards.push(episodeReward);
      
      // Log progress
      if ((episode + 1) % 10 === 0) {
        const avgReward = episodeRewards.slice(-10).reduce((sum, r) => sum + r, 0) / 10;
        console.log(`Continued Training - Episode ${episode + 1}/${additionalEpisodes}, Avg Reward: ${avgReward.toFixed(2)}`);
      }
    }
    
    // Get performance metrics
    const performance = env.getPerformance();
    
    // Save model
    const newModelId = `${modelInfo.id}_continued_${Date.now()}`;
    const modelsDir = './models';
    const modelPath = `${modelsDir}/${newModelId}`;
    await agent.saveModel(modelPath);
    
    // Create model info
    const newModelInfo: DQNModelInfo = {
      ...modelInfo,
      id: newModelId,
      name: `${modelInfo.name} (Continued)`,
      description: `${modelInfo.description} - Continued training with ${data.length} additional candles`,
      performance: {
        averageReward: episodeRewards.reduce((sum, r) => sum + r, 0) / additionalEpisodes,
        cumulativeReward: performance.cumulativeReward,
        sharpeRatio: performance.sharpeRatio,
        maxDrawdown: performance.maxDrawdown,
        winRate: performance.winRate,
        episodeRewards: [...modelInfo.performance.episodeRewards, ...episodeRewards],
        trainingEpisodes: modelInfo.performance.trainingEpisodes + additionalEpisodes
      },
      updatedAt: Date.now(),
      lastTrainedAt: Date.now(),
      status: 'ready',
      filePath: modelPath,
      episodesCompleted: modelInfo.episodesCompleted + additionalEpisodes,
      totalTrainingSteps: totalSteps
    };
    
    // Save model info
    try {
      // Dynamic import for Node.js environments only
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('fs');
        const modelInfoPath = `${modelsDir}/${newModelId}_info.json`;
        fs.writeFileSync(modelInfoPath, JSON.stringify(newModelInfo, null, 2));
      }
    } catch (error) {
      console.error('Error saving model info:', error);
    }
    
    return newModelInfo;
  } catch (error) {
    console.error('Error continuing DQN model training:', error);
    throw error;
  }
};

// Get DQN actions for a sequence of market data
export const getDQNActions = async (
  modelInfo: DQNModelInfo,
  data: any[]
): Promise<DQNAction[]> => {
  try {
    // Create agent
    const agent = new DQNAgent(modelInfo.config);
    
    // Load model
    await agent.loadModel(modelInfo.filePath as string);
    
    // Create environment
    const env = new TradingEnvironment(data);
    
    // Get actions
    const actions: DQNAction[] = [];
    let state = env.reset();
    let position = 0;
    
    for (let i = 0; i < data.length - 1; i++) {
      // Get action
      const actionIndex = agent.chooseAction(state);
      const confidence = agent.getActionConfidence(state, actionIndex);
      
      // Map action index to action type
      let actionType: 'buy' | 'sell' | 'hold';
      switch (actionIndex) {
        case 0:
          actionType = 'buy';
          position = 1;
          break;
        case 1:
          actionType = 'sell';
          position = 0;
          break;
        default:
          actionType = 'hold';
          break;
      }
      
      // Add action to list
      actions.push({
        timestamp: data[i].timestamp,
        symbol: data[i].symbol,
        action: actionType,
        confidence,
        position,
        price: data[i].close
      });
      
      // Take step in environment
      const [nextState, , done] = env.step(actionIndex);
      
      // Update state
      state = nextState;
      
      // Break if done
      if (done) break;
    }
    
    return actions;
  } catch (error) {
    console.error('Error getting DQN actions:', error);
    throw error;
  }
};

export default {
  trainDQNModel,
  continueDQNTraining,
  getDQNActions,
  DQNAgent,
  TradingEnvironment
};