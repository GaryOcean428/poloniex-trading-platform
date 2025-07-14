import { MarketData } from "@/types";
import { logger } from "./logger";

/**
 * Simplified Enhanced Backtesting Framework
 * Provides basic backtesting functionality with proper TypeScript types
 */

export interface BacktestConfig {
  initialBalance: number;
  commission: number;
  slippage: number;
  stopLoss: number;
  takeProfit: number;
}

export interface Trade {
  entryTime: number;
  exitTime: number;
  pair: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  netPnl: number;
  exitReason: string;
}

export interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  totalReturnPercent: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  trades: Trade[];
  equityCurve: Array<{ time: number; balance: number }>;
}

export class EnhancedBacktester {
  private config: BacktestConfig;

  constructor(config: BacktestConfig) {
    this.config = config;
  }

  async runBacktest(marketData: MarketData[]): Promise<BacktestResults> {
    return this.runSingleBacktest(marketData);
  }

  private async runSingleBacktest(
    marketData: MarketData[]
  ): Promise<BacktestResults> {
    const trades: Trade[] = [];
    let balance = this.config.initialBalance;
    let maxBalance = balance;
    let maxDrawdown = 0;
    let position: {
      side: "long" | "short";
      entryPrice: number;
      entryTime: number;
    } | null = null;

    const equityCurve: Array<{ time: number; balance: number }> = [];

    for (let i = 50; i < marketData.length; i++) {
      const currentCandle = marketData[i];

      if (position) {
        const exitPrice = currentCandle.close;
        const pnl =
          position.side === "long"
            ? (exitPrice - position.entryPrice) * 100
            : (position.entryPrice - exitPrice) * 100;

        const trade: Trade = {
          entryTime: position.entryTime,
          exitTime: currentCandle.timestamp,
          pair: "BTC_USDT",
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          quantity: 1,
          pnl,
          pnlPercent: (pnl / position.entryPrice) * 100,
          netPnl: pnl - this.config.commission,
          exitReason: "signal",
        };

        trades.push(trade);
        balance += trade.netPnl;
        position = null;
      } else {
        const signal = this.generateSignal(marketData.slice(0, i + 1));
        if (signal !== "HOLD") {
          position = {
            side: signal === "BUY" ? "long" : "short",
            entryPrice: currentCandle.close,
            entryTime: currentCandle.timestamp,
          };
        }
      }

      if (balance > maxBalance) {
        maxBalance = balance;
      }
      const drawdown = (maxBalance - balance) / maxBalance;
      maxDrawdown = Math.max(maxDrawdown, drawdown);

      equityCurve.push({
        time: currentCandle.timestamp,
        balance,
      });
    }

    return this.calculateResults(
      trades,
      this.config.initialBalance,
      maxDrawdown,
      equityCurve
    );
  }

  private async runWalkForwardBacktest(
    marketData: MarketData[]
  ): Promise<BacktestResults> {
    // Placeholder implementation for walk-forward optimization
    // TODO: Implement walk-forward analysis with parameter optimization
    logger.debug(
      `Walk-forward backtest with ${marketData.length} data points`,
      "Backtesting"
    );
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      trades: [],
      equityCurve: [],
    };
  }

  private generateSignal(data: MarketData[]): "BUY" | "SELL" | "HOLD" {
    if (data.length < 50) return "HOLD";
    const shortMA = this.calculateMA(data.slice(-20));
    const longMA = this.calculateMA(data.slice(-50));

    if (shortMA > longMA) return "BUY";
    if (shortMA < longMA) return "SELL";
    return "HOLD";
  }

  private calculateMA(data: MarketData[]): number {
    const sum = data.reduce((acc, candle) => acc + candle.close, 0);
    return sum / data.length;
  }

  private calculateResults(
    trades: Trade[],
    initialBalance: number,
    maxDrawdown: number,
    equityCurve: Array<{ time: number; balance: number }>
  ): BacktestResults {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        averageWin: 0,
        averageLoss: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        trades: [],
        equityCurve,
      };
    }

    const winningTrades = trades.filter((t) => t.pnl > 0).length;
    const losingTrades = trades.filter((t) => t.pnl < 0).length;
    const totalReturn = trades.reduce((sum, t) => sum + t.netPnl, 0);
    const winningTradeValues = trades
      .filter((t) => t.pnl > 0)
      .map((t) => t.pnl);
    const losingTradeValues = trades.filter((t) => t.pnl < 0).map((t) => t.pnl);

    return {
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      winRate: (winningTrades / trades.length) * 100,
      totalReturn,
      totalReturnPercent: (totalReturn / initialBalance) * 100,
      averageWin:
        winningTradeValues.length > 0
          ? winningTradeValues.reduce((a, b) => a + b, 0) /
            winningTradeValues.length
          : 0,
      averageLoss:
        losingTradeValues.length > 0
          ? Math.abs(losingTradeValues.reduce((a, b) => a + b, 0)) /
            losingTradeValues.length
          : 0,
      profitFactor: Math.abs(
        totalReturn / (losingTradeValues.reduce((a, b) => a + b, 0) || 1)
      ),
      maxDrawdown,
      maxDrawdownPercent: maxDrawdown * 100,
      trades,
      equityCurve,
    };
  }

  private closePosition(
    position: { side: "long" | "short"; entryPrice: number; entryTime: number },
    exitPrice: number,
    exitTime: number,
    exitReason: string
  ): Trade {
    const pnl =
      position.side === "long"
        ? (exitPrice - position.entryPrice) * 100
        : (position.entryPrice - exitPrice) * 100;

    return {
      entryTime: position.entryTime,
      exitTime,
      pair: "BTC_USDT",
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: 1,
      pnl,
      pnlPercent: (pnl / position.entryPrice) * 100,
      netPnl: pnl - this.config.commission,
      exitReason,
    };
  }
}
