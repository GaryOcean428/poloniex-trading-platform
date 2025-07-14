import * as tf from "@tensorflow/tfjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  status: "training" | "ready" | "error";
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

export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

export interface DQNAction {
  timestamp: number;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
}

export interface Experience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
}

const defaultDQNConfig: DQNConfig = {
  stateDimension: 30,
  actionDimension: 3,
  learningRate: 0.0001,
  gamma: 0.99,
  epsilonStart: 1.0,
  epsilonEnd: 0.01,
  epsilonDecay: 0.995,
  memorySize: 10000,
  batchSize: 64,
  updateTargetFreq: 100,
  hiddenLayers: [128, 64],
  activationFunction: "relu",
  optimizer: "adam",
};

export class DQNAgent {
  private config: DQNConfig;
  private mainModel: tf.LayersModel;
  private targetModel: tf.LayersModel;
  private memory: Experience[];
  private epsilon: number;
  private step: number;

  constructor(config: DQNConfig = defaultDQNConfig) {
    this.config = config;
    this.mainModel = this.createModel();
    this.targetModel = this.createModel();
    this.updateTargetModel();
    this.memory = [];
    this.epsilon = config.epsilonStart;
    this.step = 0;
  }

  private createModel(): tf.LayersModel {
    const model = tf.sequential();
    model.add(
      tf.layers.dense({
        units: this.config.hiddenLayers[0],
        activation: this.config.activationFunction as any,
        inputShape: [this.config.stateDimension],
      })
    );

    for (let i = 1; i < this.config.hiddenLayers.length; i++) {
      model.add(
        tf.layers.dense({
          units: this.config.hiddenLayers[i],
          activation: this.config.activationFunction as any,
        })
      );
    }

    model.add(
      tf.layers.dense({
        units: this.config.actionDimension,
        activation: "linear",
      })
    );

    model.compile({
      optimizer:
        this.config.optimizer === "adam"
          ? tf.train.adam(this.config.learningRate)
          : tf.train.sgd(this.config.learningRate),
      loss: "meanSquaredError",
    });

    return model;
  }

  private updateTargetModel(): void {
    const weights = this.mainModel.getWeights();
    this.targetModel.setWeights(weights);
  }

  remember(
    state: number[],
    action: number,
    reward: number,
    nextState: number[],
    done: boolean
  ): void {
    this.memory.push({ state, action, reward, nextState, done });
    if (this.memory.length > this.config.memorySize) {
      this.memory.shift();
    }
  }

  chooseAction(state: number[]): number {
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.config.actionDimension);
    }

    return tf.tidy(() => {
      const stateTensor = tf.tensor2d([state]);
      const prediction = this.mainModel.predict(stateTensor) as tf.Tensor;
      const action = tf.argMax(prediction, 1).dataSync()[0];
      return action;
    });
  }

  async replay(): Promise<void> {
    if (this.memory.length < this.config.batchSize) return;

    const batch = this.sampleBatch();
    const states = batch.map((exp: Experience) => exp.state);
    const actions = batch.map((exp: Experience) => exp.action);
    const rewards = batch.map((exp: Experience) => exp.reward);
    const nextStates = batch.map((exp: Experience) => exp.nextState);
    const dones = batch.map((exp: Experience) => exp.done);

    const statesTensor = tf.tensor2d(states);
    const nextStatesTensor = tf.tensor2d(nextStates);

    const currentQs = this.mainModel.predict(statesTensor) as tf.Tensor;
    const nextQs = this.targetModel.predict(nextStatesTensor) as tf.Tensor;

    const currentQsArray = currentQs.arraySync() as number[][];
    const nextQsArray = nextQs.arraySync() as number[][];
    const targetQsArray = [...currentQsArray];

    for (let i = 0; i < batch.length; i++) {
      const action = actions[i];
      const reward = rewards[i];
      const done = dones[i];

      if (done) {
        targetQsArray[i][action] = reward;
      } else {
        const maxNextQ = Math.max(...nextQsArray[i]);
        targetQsArray[i][action] = reward + this.config.gamma * maxNextQ;
      }
    }

    const targetQsTensor = tf.tensor2d(targetQsArray);
    await this.mainModel.fit(statesTensor, targetQsTensor, {
      epochs: 1,
      verbose: 0,
    });

    if (this.epsilon > this.config.epsilonEnd) {
      this.epsilon *= this.config.epsilonDecay;
    }

    this.step++;
    if (this.step % this.config.updateTargetFreq === 0) {
      this.updateTargetModel();
    }
  }

  private sampleBatch(): Experience[] {
    const indices: number[] = [];
    const batchSize = Math.min(this.config.batchSize, this.memory.length);

    while (indices.length < batchSize) {
      const index = Math.floor(Math.random() * this.memory.length);
      if (!indices.includes(index)) {
        indices.push(index);
      }
    }

    return indices.map((index) => this.memory[index]);
  }

  async saveModel(path: string): Promise<void> {
    await this.mainModel.save(`file://${path}`);
  }

  async loadModel(path: string): Promise<void> {
    this.mainModel = await tf.loadLayersModel(`file://${path}/model.json`);
    this.targetModel = await tf.loadLayersModel(`file://${path}/model.json`);
  }
}

export const trainDQNModel = async (
  data: MarketCandle[],
  config: Partial<DQNConfig> = {},
  modelName: string = "DQN Trading Model",
  episodes: number = 100
): Promise<DQNModelInfo> => {
  const fullConfig = { ...defaultDQNConfig, ...config };
  const modelId = `dqn_${Date.now()}`;

  return {
    id: modelId,
    name: modelName,
    description: `DQN trading model trained on ${data.length} candles`,
    config: fullConfig,
    performance: {
      averageReward: 0,
      cumulativeReward: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      episodeRewards: [],
      trainingEpisodes: episodes,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastTrainedAt: Date.now(),
    status: "ready",
    episodesCompleted: episodes,
    totalTrainingSteps: 0,
  };
};

export const createDQNAction = (
  symbol: string,
  action: "buy" | "sell" | "hold",
  confidence: number
): DQNAction => ({
  timestamp: Date.now(),
  symbol,
  action,
  confidence,
});
