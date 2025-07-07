import { EventEmitter } from 'events';
import { poloniexApi } from '@/services/poloniexAPI';
import { logger } from '@/utils/logger';
import { PaperTradingEngine } from './paper/PaperTradingEngine';

export type TradingMode = 'paper' | 'live';

export class TradingModeManager extends EventEmitter {
  private currentMode: TradingMode = 'paper';
  private paperEngine: PaperTradingEngine;
  private isInitialized = false;

  constructor() {
    super();
    this.paperEngine = new PaperTradingEngine();
  }

  async initialize(initialBalance?: number): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      await this.initializePaperTrading(initialBalance);
      this.isInitialized = true;
      logger.info('Trading mode manager initialized');
    } catch (error) {
      logger.error('Failed to initialize trading mode manager:', error);
      throw error;
    }
  }

  private async initializePaperTrading(initialBalance?: number): Promise<void> {
    try {
      this.paperEngine = new PaperTradingEngine({
        initialBalance: initialBalance || 10000
      });
      await this.paperEngine.initialize();
      logger.info('Paper trading engine initialized');
    } catch (error) {
      logger.error('Failed to initialize paper trading:', error);
      throw error;
    }
  }

  private async validateLiveMode(): Promise<void> {
    const apiKey = localStorage.getItem('poloniex_api_key');
    const apiSecret = localStorage.getItem('poloniex_api_secret');
    
    if (!apiKey || !apiSecret) {
      const error = new Error('API credentials required for live trading');
      logger.error(error.message);
      throw error;
    }

    try {
      // Test API connection
      const balance = await poloniexApi.getAccountBalance();
      if (!balance) {
        throw new Error('Failed to fetch account balance');
      }
      logger.info('Live mode validation successful');
    } catch (error) {
      logger.error('Live mode validation failed:', error);
      throw error;
    }
  }

  async switchMode(mode: TradingMode, initialBalance?: number): Promise<void> {
    try {
      if (mode === this.currentMode) {
        if (mode === 'paper' && initialBalance !== undefined) {
          await this.initializePaperTrading(initialBalance);
          logger.info(`Reinitialized paper trading with new balance: ${initialBalance}`);
          return;
        } else {
          logger.info(`Already in ${mode} mode`);
          return;
        }
      }

      logger.info(`Switching to ${mode} mode`);

      if (mode === 'live') {
        await this.validateLiveMode();
      } else {
        await this.initializePaperTrading(initialBalance);
      }

      this.currentMode = mode;
      this.emit('modeChanged', mode);
      
      logger.info(`Successfully switched to ${mode} mode`);
      return;
    } catch (error) {
      logger.error(`Failed to switch to ${mode} mode:`, error);
      throw error;
    }
  }

  getCurrentMode(): TradingMode {
    return this.currentMode;
  }

  getPaperEngine(): PaperTradingEngine {
    return this.paperEngine;
  }

  isLiveMode(): boolean {
    return this.currentMode === 'live';
  }
}
