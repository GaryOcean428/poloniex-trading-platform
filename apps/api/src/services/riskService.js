/**
 * Centralized Risk Management Service
 * Enforces position limits, leverage caps, stop loss/take profit, and account-level risk controls
 */

import { logger } from '../utils/logger.js';
import { pool } from '../db/connection.js';
import { evaluatePreTradeVetoes } from './riskKernel.js';

class RiskService {
  constructor() {
    this.config = {
      defaultDailyLossCapPercent: 0.15,
      defaultMaxOpenTrades: 10,
      minStopLossDistancePercent: 0.01,
      maxStopLossDistancePercent: 0.50
    };
  }

  /**
   * Check if an order passes all risk checks
   * @param {Object} order - Order to validate
   * @param {Object} account - Account information
   * @param {Object} marketInfo - Market catalog info for the symbol
   * @param {Object} [kernelInputs] - Optional inputs for the blast-door
   *   kernel. When supplied, runs the pre-trade vetoes (per-symbol
   *   exposure, self-match, unrealised-drawdown kill, strategy leverage
   *   tier, symbol-allowed-at-equity). Shape:
   *     {
   *       kernelOrder:   { symbol, side, notional, leverage, price },
   *       accountState:  { equityUsdt, unrealizedPnlUsdt,
   *                        openPositions:[{symbol,side,notional}],
   *                        restingOrders:[{symbol,side,price}] },
   *       strategy:      { liveTier: 0..5 }
   *     }
   * @returns {Promise<Object>} { allowed: boolean, reason?: string, code?: string }
   */
  async checkOrderRisk(order, account, marketInfo, kernelInputs = null) {
    try {
      // 1. Check leverage cap from market catalog
      if (marketInfo.maxLeverage && order.leverage > marketInfo.maxLeverage) {
        const reason = `Leverage ${order.leverage}x exceeds maximum ${marketInfo.maxLeverage}x for ${order.symbol}`;
        logger.warn('Risk check failed: leverage cap exceeded', {
          symbol: order.symbol,
          requestedLeverage: order.leverage,
          maxLeverage: marketInfo.maxLeverage,
          accountId: account.id
        });
        return { allowed: false, reason };
      }

      // 2. Check position size limits from risk tiers
      const positionSizeCheck = this.checkPositionSize(order, marketInfo.riskLimits);
      if (!positionSizeCheck.allowed) {
        logger.warn('Risk check failed: position size limit', {
          symbol: order.symbol,
          size: order.size,
          accountId: account.id,
          reason: positionSizeCheck.reason
        });
        return positionSizeCheck;
      }

      // 3. Check account-level daily loss cap
      const dailyLossCheck = await this.checkDailyLossCap(account);
      if (!dailyLossCheck.allowed) {
        logger.warn('Risk check failed: daily loss cap', {
          accountId: account.id,
          reason: dailyLossCheck.reason
        });
        return dailyLossCheck;
      }

      // 4. Check max open trades limit
      const openTradesCheck = await this.checkMaxOpenTrades(account);
      if (!openTradesCheck.allowed) {
        logger.warn('Risk check failed: max open trades', {
          accountId: account.id,
          reason: openTradesCheck.reason
        });
        return openTradesCheck;
      }

      // 5. Check kill switch
      const killSwitchCheck = await this.checkKillSwitch(account);
      if (!killSwitchCheck.allowed) {
        logger.error('Risk check failed: kill switch activated', {
          accountId: account.id,
          reason: killSwitchCheck.reason
        });
        return killSwitchCheck;
      }

      // 6. Blast-door kernel vetoes (per-symbol exposure, self-match,
      //    unrealised-drawdown kill, strategy leverage tier, symbol gate).
      //    Only runs when the caller has assembled kernelInputs — older
      //    call sites that don't have account state / open positions
      //    continue to work with the legacy checks above.
      if (kernelInputs) {
        const kernelDecision = evaluatePreTradeVetoes(
          kernelInputs.kernelOrder,
          kernelInputs.accountState,
          kernelInputs.strategy,
        );
        if (!kernelDecision.allowed) {
          logger.warn('Risk check failed: kernel veto', {
            accountId: account.id,
            code: kernelDecision.code,
            reason: kernelDecision.reason,
          });
          return kernelDecision;
        }
      }

      logger.info('Risk check passed', {
        symbol: order.symbol,
        leverage: order.leverage,
        size: order.size,
        accountId: account.id
      });

      return { allowed: true };
    } catch (error) {
      logger.error('Error in risk check', {
        error: error.message,
        stack: error.stack,
        order,
        accountId: account?.id
      });
      return {
        allowed: false,
        reason: 'Risk check system error - order blocked for safety'
      };
    }
  }

  /**
   * Validate that the symbol is a valid perpetual futures symbol.
   * Agent trading must only use futures PERP symbols, not spot.
   * @param {string} symbol - Trading symbol
   * @returns {{ allowed: boolean, reason?: string }}
   */
  validateFuturesSymbol(symbol) {
    if (!symbol) {
      return { allowed: false, reason: 'Symbol is required' };
    }
    const upper = symbol.toUpperCase().replace(/-/g, '_');
    if (!upper.endsWith('_PERP')) {
      return {
        allowed: false,
        reason: `Symbol "${symbol}" is not a futures perpetual symbol. Agent trading requires _PERP suffix (e.g. BTC_USDT_PERP).`
      };
    }
    return { allowed: true };
  }

  /**
   * Check position size against risk tier limits
   * @param {Object} order - Order details
   * @param {Array} riskLimits - Risk tier limits from market catalog
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  checkPositionSize(order, riskLimits) {
    if (!riskLimits || riskLimits.length === 0) {
      return { allowed: true };
    }

    const orderNotional = order.size * (order.price || 0);
    
    for (const tier of riskLimits) {
      if (tier.maxPosition && orderNotional > tier.maxPosition) {
        return {
          allowed: false,
          reason: `Position size ${orderNotional} exceeds risk tier ${tier.tier} maximum of ${tier.maxPosition}`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if account has breached daily loss cap
   * @param {Object} account - Account information
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }
   */
  async checkDailyLossCap(account) {
    try {
      const client = await pool.connect();
      try {
        const query = `
          SELECT 
            COALESCE(SUM(pnl), 0) as daily_pnl,
            COUNT(*) as trade_count
          FROM trades
          WHERE user_id = $1
            AND created_at >= NOW() - INTERVAL '24 hours'
            AND status = 'closed'
        `;
        
        const result = await client.query(query, [account.id]);
        const dailyPnl = parseFloat(result.rows[0]?.daily_pnl || 0);
        const accountBalance = parseFloat(account.balance || 10000);
        const dailyLossCap = accountBalance * this.config.defaultDailyLossCapPercent;

        if (dailyPnl < -dailyLossCap) {
          return {
            allowed: false,
            reason: `Daily loss limit reached: ${Math.abs(dailyPnl).toFixed(2)} exceeds cap of ${dailyLossCap.toFixed(2)}`
          };
        }

        return { allowed: true };
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error checking daily loss cap', {
        error: error.message,
        accountId: account.id
      });
      // FAIL CLOSED: block trading when risk checks are unavailable
      return { allowed: false, reason: 'Risk check system unavailable — order blocked for safety' };
    }
  }

  /**
   * Check if account has reached max open trades limit
   * @param {Object} account - Account information
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }
   */
  async checkMaxOpenTrades(account) {
    try {
      const client = await pool.connect();
      try {
        const query = `
          SELECT COUNT(*) as open_count
          FROM trades
          WHERE user_id = $1
            AND status = 'open'
        `;
        
        const result = await client.query(query, [account.id]);
        const openCount = parseInt(result.rows[0]?.open_count || 0);
        const maxOpenTrades = account.maxOpenTrades || this.config.defaultMaxOpenTrades;

        if (openCount >= maxOpenTrades) {
          return {
            allowed: false,
            reason: `Maximum open trades limit reached: ${openCount}/${maxOpenTrades}`
          };
        }

        return { allowed: true };
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error checking max open trades', {
        error: error.message,
        accountId: account.id
      });
      // FAIL CLOSED: block trading when risk checks are unavailable
      return { allowed: false, reason: 'Risk check system unavailable — order blocked for safety' };
    }
  }

  /**
   * Check if emergency kill switch is activated
   * @param {Object} account - Account information
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }
   */
  async checkKillSwitch(account) {
    try {
      const client = await pool.connect();
      try {
        const query = `
          SELECT emergency_stop_enabled, emergency_stop_reason
          FROM trading_config
          WHERE id = 1
        `;
        
        const result = await client.query(query);
        const config = result.rows[0];

        if (config?.emergency_stop_enabled) {
          return {
            allowed: false,
            reason: `Trading halted: ${config.emergency_stop_reason || 'Emergency stop activated'}`
          };
        }

        return { allowed: true };
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error checking kill switch', {
        error: error.message,
        accountId: account.id
      });
      // FAIL CLOSED: block trading when risk checks are unavailable
      return { allowed: false, reason: 'Risk check system unavailable — order blocked for safety' };
    }
  }

  /**
   * Validate stop loss and take profit levels
   * @param {Object} order - Order with stopLoss/takeProfit
   * @param {number} currentPrice - Current market price
   * @returns {Object} { valid: boolean, reason?: string }
   */
  validateStopLossTakeProfit(order, currentPrice) {
    const { stopLoss, takeProfit, side } = order;

    if (stopLoss) {
      const stopLossDistance = Math.abs(currentPrice - stopLoss) / currentPrice;
      
      if (stopLossDistance < this.config.minStopLossDistancePercent) {
        return {
          valid: false,
          reason: `Stop loss too close to current price: ${(stopLossDistance * 100).toFixed(2)}% (min: ${(this.config.minStopLossDistancePercent * 100).toFixed(2)}%)`
        };
      }
      
      if (stopLossDistance > this.config.maxStopLossDistancePercent) {
        return {
          valid: false,
          reason: `Stop loss too far from current price: ${(stopLossDistance * 100).toFixed(2)}% (max: ${(this.config.maxStopLossDistancePercent * 100).toFixed(2)}%)`
        };
      }

      if (side === 'buy' && stopLoss >= currentPrice) {
        return {
          valid: false,
          reason: 'Stop loss for long position must be below current price'
        };
      }
      
      if (side === 'sell' && stopLoss <= currentPrice) {
        return {
          valid: false,
          reason: 'Stop loss for short position must be above current price'
        };
      }
    }

    if (takeProfit) {
      if (side === 'buy' && takeProfit <= currentPrice) {
        return {
          valid: false,
          reason: 'Take profit for long position must be above current price'
        };
      }
      
      if (side === 'sell' && takeProfit >= currentPrice) {
        return {
          valid: false,
          reason: 'Take profit for short position must be below current price'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Log risk decision for audit trail
   * @param {Object} decision - Risk decision details
   */
  async logRiskDecision(decision) {
    try {
      const client = await pool.connect();
      try {
        const query = `
          INSERT INTO risk_decisions (
            account_id, order_id, symbol, decision, reason, 
            leverage, position_size, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `;
        
        await client.query(query, [
          decision.accountId,
          decision.orderId,
          decision.symbol,
          decision.allowed ? 'approved' : 'rejected',
          decision.reason,
          decision.leverage,
          decision.positionSize
        ]);
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error logging risk decision', {
        error: error.message,
        decision
      });
    }
  }
}

export default new RiskService();
