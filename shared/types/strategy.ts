// Placeholder for strategy types
export interface Strategy {
  id: string;
  name: string;
  parameters: Record<string, any>;
}

export interface StrategySignal {
  strategyId: string;
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  timestamp: number;
}
