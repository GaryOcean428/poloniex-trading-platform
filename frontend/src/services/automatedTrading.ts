import { AISignal, aiSignalGenerator } from "@/ml/aiSignalGenerator";
import { poloniexApi } from "@/services/poloniexAPI";
import { useAppStore } from "@/store";
import { logger } from "@/utils/logger";
import {
  executeStrategy,
  type StrategyResult,
} from "@/utils/strategyExecutors";
import { isValidAccountBalance } from "@/utils/typeGuards";
import { Strategy } from "@shared/types";

interface AutomatedTradingConfig {
  maxPositions: number;
  maxLeverage: number;
  riskPerTrade: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent?: number;
}

class AutomatedTradingService {
  private static instance: AutomatedTradingService;
  private activeStrategies: Map<string, Strategy> = new Map();
  private positions: Map<string, any> = new Map();
  private config: AutomatedTradingConfig;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Default configuration
    this.config = {
      maxPositions: 3,
      maxLeverage: 5,
      riskPerTrade: 2, // Percentage of account balance
      stopLossPercent: 2,
      takeProfitPercent: 4,
    };

    // Subscribe to position updates
    poloniexApi.onPositionUpdate(this.handlePositionUpdate.bind(this));
    poloniexApi.onLiquidationWarning(this.handleLiquidationWarning.bind(this));
    poloniexApi.onMarginUpdate(this.handleMarginUpdate.bind(this));
  }

  public static getInstance(): AutomatedTradingService {
    if (!AutomatedTradingService.instance) {
      AutomatedTradingService.instance = new AutomatedTradingService();
    }
    return AutomatedTradingService.instance;
  }

  /**
   * Start automated trading
   */
  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.updateInterval = setInterval(this.update.bind(this), 5000);
    logger.info("Automated trading started");
  }

  /**
   * Stop automated trading
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    logger.info("Automated trading stopped");
  }

  /**
   * Add strategy to automated trading
   */
  public addStrategy(strategy: Strategy): void {
    this.activeStrategies.set(strategy.id, strategy);
    logger.info(`Strategy ${strategy.id} added to automated trading`);
  }

  /**
   * Remove strategy from automated trading
   */
  public removeStrategy(strategyId: string): void {
    this.activeStrategies.delete(strategyId);
    logger.info(`Strategy ${strategyId} removed from automated trading`);
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<AutomatedTradingConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(
      "Automated trading configuration updated",
      JSON.stringify(this.config)
    );
  }

  /**
   * Main update loop with AI-enhanced decision making
   */
  private async update(): Promise<void> {
    try {
      // Get account balance
      const balance = await poloniexApi.getAccountBalance();

      if (!isValidAccountBalance(balance)) {
        logger.warn("Unable to get account balance, skipping trading update");
        return;
      }

      // Check if we can open new positions
      if (this.positions.size >= this.config.maxPositions) {
        logger.info("Maximum positions reached, skipping new trades");
        return;
      }

      // Execute each active strategy with AI enhancement
      for (const strategy of this.activeStrategies.values()) {
        try {
          // Get market data
          const marketData = await poloniexApi.getMarketData(
            strategy.parameters.pair
          );

          // Execute traditional strategy
          const strategyResult = executeStrategy(strategy, marketData);

          // Generate AI signal for comparison and enhancement
          const aiSignal = await aiSignalGenerator.generateSignal(marketData);

          // Combine strategy and AI signals
          const finalSignal = this.combineSignals(strategyResult, aiSignal);

          if (finalSignal && finalSignal.action !== "HOLD") {
            await this.executeTrade(
              strategy,
              finalSignal,
              parseFloat(balance.availableAmount)
            );
          }
        } catch (error: any) {
          logger.error(
            `Error processing strategy ${strategy.id}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      // Also run pure AI trading for configured pairs
      await this.executeAITradingSignals();
    } catch (error: any) {
      logger.error(
        "Error in automated trading update:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Execute AI-only trading signals for configured pairs
   */
  private async executeAITradingSignals(): Promise<void> {
    try {
      // Get trading settings from store
      const { defaultPair } = useAppStore.getState().trading;

      // Get market data for default pair
      const marketData = await poloniexApi.getMarketData(defaultPair);

      // Generate AI signal
      const aiSignal = await aiSignalGenerator.generateSignal(marketData);

      // Check if signal meets our criteria
      if (
        aiSignal.action !== "HOLD" &&
        aiSignal.confidence > 0.7 &&
        aiSignal.riskLevel !== "HIGH"
      ) {
        // Create a virtual strategy for AI signals
        const aiStrategy: Strategy = {
          id: "ai-signal-" + Date.now(),
          name: "AI Signal Strategy",
          description: "Pure AI-generated trading signals",
          type: "Custom",
          active: true,
          parameters: {
            pair: defaultPair,
            timeframe: "5m",
          },
          isActive: true,
          riskLevel: aiSignal.riskLevel,
          createdAt: Date.now(),
          lastModified: Date.now(),
        };

        const balance = await poloniexApi.getAccountBalance();
        if (isValidAccountBalance(balance) && balance.availableAmount) {
          await this.executeTrade(
            aiStrategy,
            aiSignal,
            parseFloat(balance.availableAmount)
          );
        }
      }
    } catch (error: any) {
      logger.error(
        "Error in AI trading signals:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Combine traditional strategy signals with AI signals
   */
  private combineSignals(
    strategyResult: StrategyResult,
    aiSignal: AISignal
  ): AISignal | null {
    // If both signals agree, increase confidence
    if (strategyResult.signal === aiSignal.action) {
      return {
        ...aiSignal,
        confidence: Math.min(aiSignal.confidence * 1.2, 1),
        reason: `Strategy + AI: ${strategyResult.reason} | ${aiSignal.reason}`,
      };
    }

    // If signals disagree, only proceed if AI signal has very high confidence
    if (
      strategyResult.signal !== aiSignal.action &&
      aiSignal.confidence > 0.8
    ) {
      return {
        ...aiSignal,
        confidence: aiSignal.confidence * 0.8,
        reason: `AI override: ${aiSignal.reason} (conflicted with strategy: ${strategyResult.reason})`,
      };
    }

    // If traditional strategy says HOLD but AI has strong signal
    if (
      !strategyResult.signal &&
      aiSignal.action !== "HOLD" &&
      aiSignal.confidence > 0.75
    ) {
      return {
        ...aiSignal,
        confidence: aiSignal.confidence * 0.9,
        reason: `AI signal: ${aiSignal.reason} (no strategy signal)`,
      };
    }

    // Default to hold if signals are weak or conflicting
    return null;
  }

  /**
   * Execute a trade based on strategy signal or AI signal
   */
  private async executeTrade(
    strategy: Strategy,
    signal: "BUY" | "SELL" | AISignal,
    availableBalance: number
  ): Promise<void> {
    try {
      const pair = strategy.parameters.pair;

      // Handle both traditional signals and AI signals
      let action: "BUY" | "SELL";
      let stopLoss: number | undefined;
      let takeProfit: number | undefined;
      let confidence = 1;
      let reason = "Strategy signal";

      if (typeof signal === "string") {
        // Traditional signal
        action = signal;
      } else {
        // AI signal
        action = signal.action as "BUY" | "SELL";
        stopLoss = signal.stopLoss;
        takeProfit = signal.takeProfit;
        confidence = signal.confidence;
        reason = signal.reason;
      }

      // Get current market data
      const marketData = await poloniexApi.getMarketData(pair);
      const lastPrice = marketData[marketData.length - 1].close;

      // Calculate position size based on risk and confidence
      const baseRiskAmount =
        (availableBalance * this.config.riskPerTrade) / 100;
      const adjustedRiskAmount = baseRiskAmount * confidence; // Reduce size for lower confidence
      const quantity = adjustedRiskAmount / lastPrice;

      // Validate minimum position size
      if (quantity < 0.001) {
        // Minimum position size
        logger.warn(`Position size too small for ${pair}: ${quantity}`);
        return;
      }

      // Place main order
      const order = await poloniexApi.placeOrder(
        pair,
        action.toLowerCase() as "buy" | "sell",
        "market",
        quantity
      );

      // Use AI-provided stop loss or calculate default
      let stopPrice: number;
      if (stopLoss) {
        stopPrice = stopLoss;
      } else {
        stopPrice =
          action === "BUY"
            ? lastPrice * (1 - this.config.stopLossPercent / 100)
            : lastPrice * (1 + this.config.stopLossPercent / 100);
      }

      // Place stop loss order
      try {
        await poloniexApi.placeConditionalOrder(
          pair,
          action === "BUY" ? "sell" : "buy",
          "stop",
          quantity,
          stopPrice
        );
      } catch (error: any) {
        logger.warn(
          "Failed to place stop loss order:",
          error instanceof Error ? error.message : String(error)
        );
      }

      // Use AI-provided take profit or calculate default
      let takeProfitPrice: number;
      if (takeProfit) {
        takeProfitPrice = takeProfit;
      } else {
        takeProfitPrice =
          action === "BUY"
            ? lastPrice * (1 + this.config.takeProfitPercent / 100)
            : lastPrice * (1 - this.config.takeProfitPercent / 100);
      }

      // Place take profit order
      try {
        await poloniexApi.placeConditionalOrder(
          pair,
          action === "BUY" ? "sell" : "buy",
          "takeProfit",
          quantity,
          takeProfitPrice
        );
      } catch (error: any) {
        logger.warn(
          "Failed to place take profit order:",
          error instanceof Error ? error.message : String(error)
        );
      }

      // Store position information
      const positionId = `${strategy.id}-${Date.now()}`;
      this.positions.set(positionId, {
        strategy: strategy.id,
        pair,
        action,
        quantity,
        entryPrice: lastPrice,
        stopPrice,
        takeProfitPrice,
        confidence,
        reason,
        timestamp: Date.now(),
        orderId: order?.id,
      });

      // Add toast notification
      const store = useAppStore.getState();
      store.addToast({
        message: `Trade executed: ${action} ${quantity.toFixed(
          4
        )} ${pair} at ${lastPrice.toFixed(2)}`,
        type: "success",
        dismissible: true,
      });

      logger.info(
        `Trade executed for strategy ${strategy.id}`,
        JSON.stringify({
          action,
          pair,
          quantity,
          entryPrice: lastPrice,
          stopPrice,
          takeProfitPrice,
          confidence,
          reason,
        })
      );
    } catch (error: any) {
      logger.error(
        "Error executing trade:",
        error instanceof Error ? error.message : String(error)
      );

      // Add error toast notification
      const store = useAppStore.getState();
      store.addToast({
        message: `Trade execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        type: "error",
        dismissible: true,
      });
    }
  }

  /**
   * Handle position update from exchange
   */
  private handlePositionUpdate(position: unknown): void {
    const p = position as Record<string, unknown>;
    const sym = typeof p.symbol === "string" ? p.symbol : `pos_${Date.now()}`;
    this.positions.set(sym, position);
    try {
      logger.info("Position updated:", JSON.stringify(p));
    } catch {
      logger.info("Position updated");
    }
  }

  /**
   * Handle liquidation warning
   */
  private handleLiquidationWarning(warning: unknown): void {
    logger.warn("Liquidation warning received", "AutomatedTrading", undefined, warning);
    // Implement emergency position closure or risk reduction
  }

  /**
   * Handle margin update
   */
  private handleMarginUpdate(margin: unknown): void {
    logger.info("Margin updated", "AutomatedTrading", margin);
    // Implement margin management logic
  }
}

export const automatedTrading = AutomatedTradingService.getInstance();
