import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import { query } from '../db/connection.js';
class ProfitBankingService extends EventEmitter {
    constructor() {
        super();
        this.isInitialized = false;
        this.bankingConfig = {
            enabled: true,
            bankingPercentage: 0.30,
            minimumProfitThreshold: 50,
            maximumSingleTransfer: 10000,
            bankingInterval: 6 * 60 * 60 * 1000,
            emergencyStopThreshold: 0.25,
            maxDailyBanking: 50000
        };
        this.bankingHistory = [];
        this.dailyBankingTotal = 0;
        this.lastBankingCheck = null;
        this.lastDailyReset = new Date().toDateString();
        this.stats = {
            totalBanked: 0,
            totalTransfers: 0,
            averageTransferSize: 0,
            lastBankingTime: null,
            failedTransfers: 0,
            emergencyStops: 0
        };
        this.logger = logger;
        this.bankingTimer = null;
    }
    async initialize() {
        try {
            this.logger.info('💰 Initializing Profit Banking Service...');
            await this.loadBankingHistory();
            this.checkDailyReset();
            this.startBankingTimer();
            this.isInitialized = true;
            this.logger.info('✅ Profit Banking Service initialized');
            this.emit('initialized', {
                totalBanked: this.stats.totalBanked,
                totalTransfers: this.stats.totalTransfers,
                config: this.bankingConfig
            });
        }
        catch (error) {
            this.logger.error('❌ Failed to initialize Profit Banking Service:', error);
            throw error;
        }
    }
    startBankingTimer() {
        if (this.bankingTimer) {
            clearInterval(this.bankingTimer);
        }
        this.bankingTimer = setInterval(async () => {
            try {
                await this.checkAndBankProfits();
            }
            catch (error) {
                this.logger.error('❌ Error in banking timer:', error);
            }
        }, this.bankingConfig.bankingInterval);
        this.logger.info(`⏰ Banking timer started - checking every ${this.bankingConfig.bankingInterval / (60 * 60 * 1000)} hours`);
    }
    stopBankingTimer() {
        if (this.bankingTimer) {
            clearInterval(this.bankingTimer);
            this.bankingTimer = null;
            this.logger.info('⏹️ Banking timer stopped');
        }
    }
    async checkAndBankProfits() {
        if (!this.bankingConfig.enabled) {
            return;
        }
        try {
            this.logger.info('🔍 Checking for profits to bank...');
            this.checkDailyReset();
            const futuresBalance = await this.getFuturesBalance();
            const initialBalance = await this.getInitialBalance();
            const currentProfit = futuresBalance - initialBalance;
            if (currentProfit <= 0) {
                this.logger.info('📊 No profits to bank');
                return;
            }
            if (currentProfit < this.bankingConfig.minimumProfitThreshold) {
                this.logger.info(`📊 Profit ${currentProfit.toFixed(2)} below threshold ${this.bankingConfig.minimumProfitThreshold}`);
                return;
            }
            if (await this.checkEmergencyStop(futuresBalance)) {
                this.logger.warn('🚨 Emergency stop triggered - banking disabled');
                return;
            }
            const bankingAmount = Math.min(currentProfit * this.bankingConfig.bankingPercentage, this.bankingConfig.maximumSingleTransfer, this.bankingConfig.maxDailyBanking - this.dailyBankingTotal);
            if (bankingAmount < 1) {
                this.logger.info('📊 Banking amount too small or daily limit reached');
                return;
            }
            await this.executeBanking(bankingAmount, currentProfit);
        }
        catch (error) {
            this.logger.error('❌ Error in banking check:', error);
            this.stats.failedTransfers++;
        }
    }
    async executeBanking(amount, totalProfit) {
        try {
            this.logger.info(`💸 Banking ${amount.toFixed(2)} USDT to spot account...`);
            const transferResult = await poloniexFuturesService.transferToSpot(amount);
            if (transferResult.success) {
                const bankingRecord = {
                    id: Date.now(),
                    timestamp: new Date(),
                    amount: amount,
                    totalProfit: totalProfit,
                    futuresBalanceBefore: await this.getFuturesBalance(),
                    futuresBalanceAfter: await this.getFuturesBalance() - amount,
                    transferId: transferResult.transferId,
                    status: 'completed'
                };
                this.bankingHistory.push(bankingRecord);
                this.stats.totalBanked += amount;
                this.stats.totalTransfers++;
                this.stats.averageTransferSize = this.stats.totalBanked / this.stats.totalTransfers;
                this.stats.lastBankingTime = new Date();
                this.dailyBankingTotal += amount;
                await this.saveBankingRecord(bankingRecord);
                this.logger.info(`✅ Successfully banked ${amount.toFixed(2)} USDT`);
                this.emit('profitBanked', {
                    amount: amount,
                    totalBanked: this.stats.totalBanked,
                    totalProfit: totalProfit,
                    transferId: transferResult.transferId
                });
            }
            else {
                throw new Error(`Transfer failed: ${transferResult.error}`);
            }
        }
        catch (error) {
            this.logger.error('❌ Banking execution failed:', error);
            const failedRecord = {
                id: Date.now(),
                timestamp: new Date(),
                amount: amount,
                totalProfit: totalProfit,
                status: 'failed',
                error: error.message
            };
            this.bankingHistory.push(failedRecord);
            this.stats.failedTransfers++;
            this.emit('bankingFailed', {
                amount: amount,
                error: error.message,
                totalProfit: totalProfit
            });
            throw error;
        }
    }
    async manualBanking(amount) {
        try {
            this.logger.info(`🖱️ Manual banking requested: ${amount} USDT`);
            if (amount <= 0) {
                throw new Error('Banking amount must be positive');
            }
            if (amount > this.bankingConfig.maximumSingleTransfer) {
                throw new Error(`Amount exceeds maximum single transfer: ${this.bankingConfig.maximumSingleTransfer}`);
            }
            if (this.dailyBankingTotal + amount > this.bankingConfig.maxDailyBanking) {
                throw new Error(`Amount would exceed daily banking limit: ${this.bankingConfig.maxDailyBanking}`);
            }
            const futuresBalance = await this.getFuturesBalance();
            if (amount > futuresBalance * 0.9) {
                throw new Error('Insufficient futures balance for banking');
            }
            await this.executeBanking(amount, futuresBalance);
            return true;
        }
        catch (error) {
            this.logger.error('❌ Manual banking failed:', error);
            throw error;
        }
    }
    async checkEmergencyStop(currentBalance) {
        const initialBalance = await this.getInitialBalance();
        const drawdown = (initialBalance - currentBalance) / initialBalance;
        if (drawdown > this.bankingConfig.emergencyStopThreshold) {
            this.stats.emergencyStops++;
            this.emit('emergencyStop', {
                drawdown: drawdown,
                currentBalance: currentBalance,
                initialBalance: initialBalance
            });
            return true;
        }
        return false;
    }
    async getFuturesBalance() {
        try {
            const accountInfo = await poloniexFuturesService.getAccountInfo();
            return parseFloat(accountInfo.balance || 0);
        }
        catch (error) {
            this.logger.error('❌ Failed to get futures balance:', error);
            return 0;
        }
    }
    async getInitialBalance() {
        try {
            const result = await query('SELECT initial_balance FROM trading_config WHERE id = 1');
            return result.rows[0]?.initial_balance || 10000;
        }
        catch (error) {
            this.logger.error('❌ Failed to get initial balance:', error);
            return 10000;
        }
    }
    async loadBankingHistory() {
        try {
            const result = await query(`
        SELECT * FROM banking_history 
        ORDER BY timestamp DESC 
        LIMIT 100
      `);
            this.bankingHistory = result.rows;
            const completedTransfers = this.bankingHistory.filter(r => r.status === 'completed');
            this.stats.totalBanked = completedTransfers.reduce((sum, r) => sum + r.amount, 0);
            this.stats.totalTransfers = completedTransfers.length;
            this.stats.averageTransferSize = this.stats.totalTransfers > 0 ?
                this.stats.totalBanked / this.stats.totalTransfers : 0;
            this.stats.failedTransfers = this.bankingHistory.filter(r => r.status === 'failed').length;
            if (completedTransfers.length > 0) {
                this.stats.lastBankingTime = new Date(completedTransfers[0].timestamp);
            }
        }
        catch (error) {
            this.logger.error('❌ Failed to load banking history:', error);
            this.bankingHistory = [];
        }
    }
    async saveBankingRecord(record) {
        try {
            await query(`
        INSERT INTO banking_history (
          id, timestamp, amount, total_profit, 
          futures_balance_before, futures_balance_after,
          transfer_id, status, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
                record.id,
                record.timestamp,
                record.amount,
                record.totalProfit,
                record.futuresBalanceBefore,
                record.futuresBalanceAfter,
                record.transferId,
                record.status,
                record.error || null
            ]);
        }
        catch (error) {
            this.logger.error('❌ Failed to save banking record:', error);
        }
    }
    checkDailyReset() {
        const today = new Date().toDateString();
        if (this.lastDailyReset !== today) {
            this.dailyBankingTotal = 0;
            this.lastDailyReset = today;
            this.logger.info('📅 Daily banking total reset');
        }
    }
    updateConfig(newConfig) {
        this.bankingConfig = { ...this.bankingConfig, ...newConfig };
        this.logger.info('⚙️ Banking configuration updated');
        if (newConfig.bankingInterval) {
            this.startBankingTimer();
        }
        this.emit('configUpdated', this.bankingConfig);
    }
    getStats() {
        return {
            ...this.stats,
            dailyBankingTotal: this.dailyBankingTotal,
            config: this.bankingConfig,
            recentHistory: this.bankingHistory.slice(0, 10)
        };
    }
    getBankingHistory(limit = 50) {
        return this.bankingHistory.slice(0, limit);
    }
    setBankingEnabled(enabled) {
        this.bankingConfig.enabled = enabled;
        this.logger.info(`💰 Banking ${enabled ? 'enabled' : 'disabled'}`);
        if (enabled) {
            this.startBankingTimer();
        }
        else {
            this.stopBankingTimer();
        }
        this.emit('bankingToggled', { enabled });
    }
    async shutdown() {
        this.stopBankingTimer();
        this.logger.info('💰 Profit Banking Service shutdown');
    }
}
export default new ProfitBankingService();
