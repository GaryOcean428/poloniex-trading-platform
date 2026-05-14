/**
 * loop_execution.ts — the Monkey kernel's order-placement / outcome
 * methods, extracted verbatim from loop.ts (2026-05-14 modularization).
 *
 * These are the large, deeply kernel-coupled methods (forceHarvestAgentLStack,
 * closeHeldPosition, executeEntry, witnessExit). They are moved as free
 * functions with an explicit `this: MonkeyKernel` parameter — the bodies
 * are byte-identical to the former methods (no rename), so behaviour is
 * unchanged. The MonkeyKernel class keeps thin delegate methods that call
 * these via `.call(this, ...)`, so every call site and the public API are
 * untouched. A handful of formerly-`private` MonkeyKernel members were
 * widened (still effectively internal) so these functions can reach them.
 */
import { EventEmitter } from 'events';

import { pool } from '../../db/connection.js';
import { getEngineVersion } from '../../utils/engineVersion.js';
import { logger } from '../../utils/logger.js';
import { apiCredentialsService } from '../apiCredentialsService.js';
import { getCurrentExecutionMode } from '../executionModeService.js';
import { getMaxLeverage, getPrecisions } from '../marketCatalog.js';
import mlPredictionService from '../mlPredictionService.js';
import poloniexFuturesService from '../poloniexFuturesService.js';
import { resolveExchangePositionSide, resolveExchangePositionNotional } from '../exchangePositionSide.js';
import { fetchAccountContext } from './loop_account.js';
import {
  findOpenMonkeyTrade as dbFindOpenMonkeyTrade,
  findOpenMonkeyTradesByLane as dbFindOpenMonkeyTradesByLane,
  sumOpenContractsForPosition as dbSumOpenContractsForPosition,
  sumOpenAgentMargin as dbSumOpenAgentMargin,
  sumOpenAgentNotional as dbSumOpenAgentNotional,
} from './loop_db.js';
import {
  evaluatePreTradeVetoes,
  type KernelAccountState,
  type KernelContext,
  type KernelOrder,
} from '../riskKernel.js';

import { getKellyRollingStats } from './kelly_rolling_stats.js';
import { forge, forgeBankWriteLive, shadowThreshold } from './forge.js';

import {
  BASIN_DIM,
  KAPPA_STAR,
  fisherRao,
  frechetMean,
  uniformBasin,
  type Basin,
} from './basin.js';
import { BasinSync } from './basin_sync.js';
import { BusEventType, getKernelBus, type KernelBus } from './kernel_bus.js';
import {
  callTickRun,
  type TickRunAccount,
  type TickRunOHLCV,
  type TickRunSymbolState,
} from './kernel_client.js';
// Post-cutover: TS K-cognition primitives (computeEmotions / detectMode /
// computeMotivators / computeNeurochemicals) are NOT called by loop.ts —
// Python is authoritative. We import the types only so the synthesized
// bindings from pyDecision.derivation compile.
import type { EmotionState } from './emotions.js';
import { MODE_PROFILES, MonkeyMode } from './modes.js';
import { summarizeNC, type NeurochemicalState } from './neurochemistry.js';
import { mlAgentDecide } from '../ml_agent/decide.js';
import type { MLAgentInputs } from '../ml_agent/types.js';
import { Arbiter } from '../arbiter/arbiter.js';
import {
  appendUnit as turtleAppendUnit,
  clearUnitsAfterExit as turtleClearUnits,
  newTurtleState,
  turtleAgentDecide,
  turtleMinEquityUsdt,
  type TurtleAgentInputs,
  type TurtleState,
} from '../turtle_agent/index.js';
// Post-cutover: perception.ts / candlePatterns.ts / classifyRegime are
// not called from loop.ts (Python computes basin / candles / regime).
// We import only the OHLCVCandle type for the array cast at the
// poloniex-fetch boundary, plus chop-suppression constants used by
// the dispatch tree's entry-gate.
import type { OHLCVCandle } from './perception.js';
import {
  CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
  CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT,
  chopSuppressEntry,
  type RegimeReading,
} from './regime.js';
import { evaluateBankWrite } from './learning_gate_client.js';
import { resonanceBank } from './resonance_bank.js';
import { computeSelfObservation, type SelfObservation } from './self_observation.js';
import { WorkingMemory, type Bubble } from './working_memory.js';
import {
  kernelShouldEnter,
  shouldDCAAdd,
  shouldExit,
  shouldProfitHarvest,
  shouldScalpExit,
  type BasinState,
  type Direction,
  type LaneType,
} from './executive.js';
import { evaluateRejustification } from './held_position_rejustification.js';
import {
  computeAgentHeadroom,
  clampSizeToHeadroom,
  computeAgentNotionalHeadroom,
  clampMarginToNotionalHeadroom,
} from './agentEquityBound.js';
import { planCloseChunks } from './closeChunker.js';
import { agentLDecide } from './agent_L_classifier.js';
import {
  newMTFState,
  onTickAppend as mtfOnTickAppend,
  mtfDecide,
  recordAgreementTimestamps as mtfRecordAgreement,
  isLongestHorizonExpired as mtfIsLongestHorizonExpired,
} from './mtfLClassifier.js';
import {
  regimeSizing as computeRegimeSizing,
  trailingRegimeStop as continuousTrailingRegimeStop,
} from './regimeSizing.js';
import {
  applyOutcomeToState,
  decayPerAgentState,
  newPerAgentState,
  recordDecision,
  riskModulator,
  type PerAgentState,
  type AgentOutcomeEvent,
  type AgentDecisionRecord,
} from './per_agent_state.js';
import {
  buildCrossAgentContext,
  convictionDampenerFromBus,
  type CrossAgentContext,
  type AgentLabel,
} from './per_agent_bus.js';
import { foresightVeto } from './per_agent_foresight.js';
import {
  clampNewContractsToCap,
  getMaxContractsPerPosition,
} from './positionContractsBound.js';

// Module-level constants + kill-switch and the loop type definitions
// were extracted to loop_constants.ts / loop_types.ts (2026-05-14
// modularization) — no behavioural change, loop.ts is now the
// orchestration spine + the MonkeyKernel class only.
import {
  DEFAULT_SYMBOLS,
  DEFAULT_TICK_MS,
  OHLCV_LOOKBACK,
  HISTORY_MAX,
  REWARD_HALF_LIFE_MS,
  REWARD_QUEUE_MAX,
  REGIME_STABILITY_TICKS_FOR_EXIT,
  BUS_RING_CAP,
  isTradingPaused,
} from './loop_constants.js';
import type {
  ActivityReward,
  MonkeyKernelConfig,
  SymbolState,
} from './loop_types.js';


/**
 * MonkeyKernel — the top-level kernel that ticks Monkey.
 *
 * One instance per process. Holds per-symbol SymbolState.
 */
import type { MonkeyKernel } from './loop.js';
import { WITNESS_DEDUP_WINDOW_MS } from './loop_constants.js';

export async function forceHarvestAgentLStack(
    this: MonkeyKernel,
    symbol: string,
    lastPrice: number,
  ): Promise<void> {
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;
    const baseHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT) || 0.003;
    if (!Number.isFinite(baseHarvestPct) || baseHarvestPct <= 0) return;

    // 2026-05-13 — regime-aware harvest threshold.
    //
    // The single base threshold (0.3%) was calibrated for medium-vol
    // sideways tape. Two failure modes observed:
    //   chop  (range < ~1.5%, tape ~0): harvest opportunities are
    //         scarce; even small green prints should be captured
    //         → use LOWER threshold so wins aren't left on the table
    //   trend (|tape| > 0.3): position can ride further; capturing at
    //         0.3% on a 2-3% directional move leaves significant PnL
    //         → use HIGHER threshold so winners run
    //
    // Regime detection uses Monkey's own basin-velocity and tape
    // signals (already QIG-derived per processSymbol). These are
    // surfaced on the SymbolState's latestBasinSnapshot.
    //
    // Hot-regime (dopamine + recent-wins) heuristic from PR #653 is
    // KEPT as an override: if the agent has been winning + dopamine
    // is high, threshold also widens to hot — even on chop.
    const chopHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT_CHOP) || 0.0025;
    const trendHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT_TREND) || 0.0045;
    const hotHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT_HOT) || 0.006;
    const hotHarvestDopamineFloor =
      Number(process.env.MONKEY_AGENT_L_HARVEST_HOT_DOPAMINE_FLOOR) || 0.7;

    const symState = this.symbolStates.get(symbol);
    const recentPnls = symState?.recentLHarvestPnls ?? [];
    const lDopamine =
      symState?.agentStates?.L?.neurochemistry?.dopamine ?? 0;
    const allRecentPositive =
      recentPnls.length >= 5 && recentPnls.every((p) => p > 0);
    const hotRegime = allRecentPositive && lDopamine > hotHarvestDopamineFloor;

    const snap = symState?.latestBasinSnapshot;
    const tapeAbs = snap ? Math.abs(snap.tapeTrend) : 0;
    // chop: weak tape across BOTH absolute magnitude and basin direction.
    // trend: strong, directional tape (|tape| > 0.3).
    const isChop = tapeAbs < 0.15 && snap !== null && snap !== undefined;
    const isTrend = tapeAbs > 0.30;

    let harvestPct: number;
    let regimeLabel: 'hot' | 'trend' | 'chop' | 'base';
    if (hotRegime) {
      harvestPct = hotHarvestPct;
      regimeLabel = 'hot';
    } else if (isTrend) {
      harvestPct = trendHarvestPct;
      regimeLabel = 'trend';
    } else if (isChop) {
      harvestPct = chopHarvestPct;
      regimeLabel = 'chop';
    } else {
      harvestPct = baseHarvestPct;
      regimeLabel = 'base';
    }

    const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
    let lRows: Array<{
      id: string;
      side: string;
      entry_price: string;
      quantity: string;
      lane: string;
    }>;
    try {
      const result = await pool.query(
        `SELECT id, side, entry_price, quantity, lane
           FROM autonomous_trades
          WHERE status = 'open'
            AND symbol = $1
            AND agent = 'L'
            AND reason LIKE $2`,
        [symbol, reasonPattern],
      );
      lRows = result.rows as typeof lRows;
    } catch (err) {
      logger.debug('[AgentL] forceHarvest query failed', {
        symbol, err: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (lRows.length === 0) return;

    // Bucket by side — L can hold opposite directions across rows
    // only if entries spanned a regime flip. Each side harvests
    // independently against its own aggregate notional.
    const bySide: Record<'long' | 'short', typeof lRows> = { long: [], short: [] };
    const normSide = (s: string): 'long' | 'short' =>
      s === 'buy' || s === 'long' ? 'long' : 'short';
    for (const r of lRows) bySide[normSide(r.side)].push(r);

    for (const sideKey of ['long', 'short'] as const) {
      const rows = bySide[sideKey];
      if (rows.length === 0) continue;
      const aggQty = rows.reduce(
        (s, r) => s + Math.abs(Number(r.quantity) || 0),
        0,
      );
      if (aggQty <= 0) continue;
      const sumWeightedEntry = rows.reduce(
        (s, r) => s + Number(r.entry_price) * Math.abs(Number(r.quantity) || 0),
        0,
      );
      const aggEntry = sumWeightedEntry / aggQty;
      const aggNotional = aggEntry * aggQty;
      const sideSign = sideKey === 'long' ? 1 : -1;
      const aggPnl = (lastPrice - aggEntry) * aggQty * sideSign;
      const pnlPct = aggNotional > 0 ? aggPnl / aggNotional : 0;
      // 2026-05-13 — STOP-LOSS HARVEST. Fire on aggregate loss
      // beyond -MONKEY_AGENT_L_STOP_LOSS_PCT (default 0.005 = 0.5%
      // adverse on notional). Win-harvest threshold ladder
      // (chop/base/trend/hot) still applies on the upside.
      //
      // 2026-05-13 Change B — HORIZON-BOUNDED EXIT.
      //
      // Trades must not run past L's predicted forward horizon
      // unless fresh L signal extends the ride. Once the horizon
      // elapses without L re-confirming the side, force-exit
      // regardless of PnL. Implements the canonical Lorentzian's
      // bar-count exit (4 bars = forecast window) on our cadence.
      //
      // Horizon: config.horizon × tickMs = 120 × 30s = 60 min.
      // Re-confirmation: each tick where L's decision proposes the
      // same side updates `lLastConfirmedAtMsBySide[side]`.
      const stopLossPct =
        Number(process.env.MONKEY_AGENT_L_STOP_LOSS_PCT) || 0.005;
      const horizonTicks =
        Number(process.env.MONKEY_AGENT_L_HORIZON_TICKS) || 120;
      const horizonMs = horizonTicks * this.tickMs;
      const lastConfirmedAt = symState?.lLastConfirmedAtMsBySide?.[sideKey] ?? null;
      const isHorizonExpired =
        lastConfirmedAt !== null && (Date.now() - lastConfirmedAt) > horizonMs;
      const isStopLossHarvest = pnlPct <= -stopLossPct;
      const isWinHarvest = pnlPct >= harvestPct;
      // 2026-05-13 — trailing regime stop. Position opened under one
      // cognitive mode must exit if the kernel transitions to a
      // categorically different mode (EXPLORATION ↔ INTEGRATION).
      // The leverage / size / horizon thesis that justified the
      // entry no longer holds. INVESTIGATION is the transition zone
      // and doesn't trigger by itself; only crossings of the gap
      // count.
      const modeAtEntry = symState?.lModeAtConfirmedBySide?.[sideKey] ?? null;
      const modeNow = String(symState?.lastMode ?? '');
      const isAdverseModeTransition =
        modeAtEntry !== null && modeAtEntry !== modeNow && (
          (modeAtEntry === 'exploration' && modeNow === 'integration') ||
          (modeAtEntry === 'integration' && modeNow === 'exploration')
        );
      // 2026-05-13 MTF Phase 2 — longest-agreeing-horizon exit.
      // When the longest timeframe that agreed at entry stops
      // re-confirming for its forecast window, exit. The agreement
      // clocks (state.mtfState.lastAgreementByTfSide) are updated
      // every tick by mtfRecordAgreement; here we just check whether
      // the longest-at-entry timeframe's clock has elapsed.
      const longestAtEntry = symState?.mtfLongestAgreeingBySide?.[sideKey] ?? null;
      const isMtfHorizonExpired = longestAtEntry !== null && symState
        ? mtfIsLongestHorizonExpired(symState.mtfState, sideKey, longestAtEntry, Date.now(), this.tickMs)
        : false;
      // 2026-05-13 — continuous regime DRIFT stop. Even within the
      // same discrete mode, if r has drifted past the threshold
      // since position open, the entry thesis no longer holds.
      // Catches transitions inside (e.g.) EXPLORATION between
      // r=0.9 → r=0.5 that don't cross to INTEGRATION but invalidate
      // the high-leverage scalp assumption.
      const rAtEntry = symState?.rScoreAtEntryBySide?.[sideKey] ?? null;
      const rNow = symState?.rScoreCurrent ?? null;
      const continuousDriftDelta =
        Number(process.env.MONKEY_AGENT_L_REGIME_DRIFT_DELTA) || 0.30;
      const isContinuousRegimeDrift =
        rAtEntry !== null && rNow !== null &&
        continuousTrailingRegimeStop(rAtEntry, rNow, continuousDriftDelta);
      if (!isStopLossHarvest && !isWinHarvest && !isHorizonExpired && !isAdverseModeTransition && !isMtfHorizonExpired && !isContinuousRegimeDrift) continue;
      const harvestKind: 'win' | 'stop_loss' | 'horizon_expired' | 'regime_transition' | 'mtf_horizon_expired' | 'continuous_regime_drift' =
        isStopLossHarvest ? 'stop_loss'
          : isWinHarvest ? 'win'
            : isHorizonExpired ? 'horizon_expired'
              : isAdverseModeTransition ? 'regime_transition'
                : isMtfHorizonExpired ? 'mtf_horizon_expired'
                  : 'continuous_regime_drift';

      logger.info('[AgentL] force-harvest threshold met', {
        symbol,
        side: sideKey,
        kind: harvestKind,
        rows: rows.length,
        aggQty: aggQty.toFixed(6),
        aggEntry: aggEntry.toFixed(2),
        aggNotional: aggNotional.toFixed(2),
        aggPnl: aggPnl.toFixed(4),
        pnlPct: (pnlPct * 100).toFixed(3),
        threshold: isStopLossHarvest
          ? `-${(stopLossPct * 100).toFixed(3)} (stop-loss)`
          : isHorizonExpired
            ? `horizon ${horizonTicks}t (${(horizonMs / 60000).toFixed(0)}min)`
            : isAdverseModeTransition
              ? `regime ${modeAtEntry}→${modeNow}`
              : isMtfHorizonExpired
                ? `mtf-horizon ${longestAtEntry}`
                : isContinuousRegimeDrift
                  ? `r-drift ${rAtEntry?.toFixed(2) ?? '?'}→${rNow?.toFixed(2) ?? '?'} (Δ${Math.abs((rAtEntry ?? 0) - (rNow ?? 0)).toFixed(2)})`
                  : (harvestPct * 100).toFixed(3),
        ...(isHorizonExpired && lastConfirmedAt
          ? { ageMin: ((Date.now() - lastConfirmedAt) / 60000).toFixed(1) }
          : {}),
        regime: regimeLabel,
        dopamine: lDopamine.toFixed(2),
        recentHarvests: recentPnls.length,
      });

      // Reduce-only market for L's aggregate qty. In HEDGE mode pass
      // posSide; in ONE_WAY rely on opposite-side semantics.
      let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
      try {
        const userRow = await pool.query(
          `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
        );
        const userId = String(
          (userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '',
        );
        if (!userId) return;
        const c = await apiCredentialsService.getCredentials(userId, 'poloniex');
        if (!c) return;
        credentials = c;
      } catch (err) {
        logger.warn('[AgentL] force-harvest credentials fetch failed', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // Lot-size round.
      let formattedSize = aggQty;
      let symbolLotSize = 0;
      try {
        const precisions = await getPrecisions(symbol);
        if (precisions.lotSize && precisions.lotSize > 0) {
          symbolLotSize = precisions.lotSize;
          formattedSize = Math.floor(aggQty / precisions.lotSize) * precisions.lotSize;
        }
      } catch { /* use raw */ }
      if (formattedSize <= 0) {
        logger.debug('[AgentL] force-harvest lot rounding zero', {
          symbol, aggQty, symbolLotSize,
        });
        continue;
      }

      const closeSide: 'buy' | 'sell' = sideKey === 'long' ? 'sell' : 'buy';
      const isHedge = this.positionDirectionMode === 'HEDGE';
      const closePosSide: 'LONG' | 'SHORT' | undefined =
        isHedge ? (sideKey === 'long' ? 'LONG' : 'SHORT') : undefined;

      let orderId: string | null = null;
      try {
        const exchangeOrder = await poloniexFuturesService.placeOrder(
          credentials,
          {
            symbol,
            side: closeSide,
            type: 'market',
            size: formattedSize,
            lotSize: symbolLotSize,
            reduceOnly: !isHedge,  // HEDGE rejects reduceOnly per #10
          },
          {
            positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
            ...(closePosSide ? { posSide: closePosSide } : {}),
          },
        );
        orderId =
          exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
          exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn('[AgentL] force-harvest exchange order rejected', {
          symbol, side: sideKey, qty: formattedSize, err: errMsg,
        });
        // 2026-05-13 — Poloniex 21002 "Position not enough" means the
        // exchange doesn't have the qty the DB thinks it has. These
        // rows are PHANTOMS — keeping them open spins this branch
        // every tick (observed: 11:37→11:47Z BTC stop-loss tried 13×
        // with same -$6 PnL, never closed, position bled). Ghost the
        // rows immediately with reason 'position_mismatch_phantom'
        // so subsequent ticks skip them. PnL = null because we never
        // had a real close.
        if (errMsg.includes('code=21002') || errMsg.includes('Position not enough')) {
          try {
            for (const row of rows) {
              await pool.query(
                `UPDATE autonomous_trades
                    SET status = 'closed',
                        exit_reason = 'position_mismatch_phantom',
                        exit_time = NOW(),
                        pnl = COALESCE(pnl, 0)
                  WHERE id = $1`,
                [row.id],
              );
            }
            logger.warn('[AgentL] phantom rows ghost-closed (Poloniex 21002)', {
              symbol, side: sideKey, ghostedRows: rows.length,
            });
          } catch (updErr) {
            logger.error('[AgentL] phantom ghost-close DB update failed', {
              symbol, err: updErr instanceof Error ? updErr.message : String(updErr),
            });
          }
        }
        continue;
      }
      if (!orderId) {
        logger.warn('[AgentL] force-harvest no orderId returned', {
          symbol, side: sideKey,
        });
        continue;
      }

      // Update only L's rows (close them with proportional PnL).
      try {
        for (const row of rows) {
          const rowQty = Math.abs(Number(row.quantity) || 0);
          const qtyShare = aggQty > 0 ? rowQty / aggQty : 0;
          const rowPnl = aggPnl * qtyShare;
          await pool.query(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, pnl = $4
              WHERE id = $5`,
            [lastPrice, 'agent_l_force_harvest', orderId, rowPnl, row.id],
          );
          this.arbiter.recordSettled('L', rowPnl);
          this.applyOutcomeToAgent(symbol, 'L', sideKey, rowPnl);
        }
      } catch (err) {
        logger.error('[AgentL] force-harvest DB update failed — ORPHAN RISK', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('[AgentL] force-harvest CLOSED', {
        symbol, side: sideKey, orderId,
        rowsClosed: rows.length,
        aggPnl: aggPnl.toFixed(4),
        regime: regimeLabel,
      });

      // 2026-05-11 — record cooldown timestamp + push pnl into the
      // recent-harvests ring so subsequent entries see the cooldown
      // gate, and the adaptive threshold can lift on a hot streak.
      // 2026-05-13 — clear lLastConfirmedAtMsBySide so the next entry
      // starts a fresh horizon clock (no inherited expiry from prior
      // stack).
      if (symState) {
        symState.lForceHarvestAtMsBySide[sideKey] = Date.now();
        symState.lLastConfirmedAtMsBySide[sideKey] = null;
        symState.lModeAtConfirmedBySide[sideKey] = null;
        symState.mtfLongestAgreeingBySide[sideKey] = null;
        symState.rScoreAtEntryBySide[sideKey] = null;
        symState.recentLHarvestPnls.push(aggPnl);
        if (symState.recentLHarvestPnls.length > 5) {
          symState.recentLHarvestPnls.shift();
        }
      }

      this.bus.publish({
        type: BusEventType.EXIT_TRIGGERED,
        source: this.instanceId,
        symbol,
        payload: {
          agent: 'L',
          heldSide: sideKey,
          markPrice: lastPrice,
          orderId,
          pnl: aggPnl,
          exitReason: 'agent_l_force_harvest',
        },
      });
    }
  }

export async function closeHeldPosition(
    this: MonkeyKernel,req: {
    symbol: string;
    tradeId: string;
    heldSide: 'long' | 'short';
    markPrice: number;
    exitReason: string;
    pnlAtDecision: number;
    /** Proposal #10: when provided, close only autonomous_trades rows
     *  matching this lane (and send ``posSide`` on the exchange close
     *  in HEDGE mode so the other lane stays untouched). When omitted,
     *  legacy behavior — close all open rows under (kernel, symbol). */
    lane?: 'scalp' | 'swing' | 'trend';
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, tradeId, heldSide, markPrice, exitReason, pnlAtDecision } = req;
    const closeLane = req.lane;

    // Load credentials + position to know size to close.
    let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      const userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
      if (!userId) return { executed: false, orderId: null, reason: 'no_credentials' };
      const c = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!c) return { executed: false, orderId: null, reason: 'credentials_missing' };
      credentials = c;
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `close_credentials_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Read exchange position size (tradeId's quantity may diverge from
    // actual exchange state if partial fills or reconciler updates).
    // Proposal #10 — in HEDGE mode + lane scoped close, the exchange
    // qty for *this side* must be used (the symbol may have an opposite
    // side too); in ONE_WAY mode there's only one net position so the
    // whole-symbol qty applies.
    let exchangeQty = 0;
    try {
      const positions = await poloniexFuturesService.getPositions(credentials);
      const forSymbol = (Array.isArray(positions) ? positions : []).filter(
        (p: Record<string, unknown>) => String(p.symbol ?? '') === symbol,
      );
      if (this.positionDirectionMode === 'HEDGE' && closeLane) {
        // Match by side — under HEDGE Poloniex returns one position per side.
        // Side MUST come from resolveExchangePositionSide (posSide-first):
        // v3 HEDGE positions carry the side in `posSide`, not `side`, and
        // `qty` is a positive magnitude — the old `p.side ?? p.posSide`
        // string-match silently fell through to forSymbol[0] (wrong leg).
        const target = forSymbol.find((p: Record<string, unknown>) =>
          resolveExchangePositionSide(p) === heldSide,
        ) ?? forSymbol[0];
        exchangeQty = Math.abs(Number(target?.qty ?? target?.size ?? 0));
      } else {
        const target = forSymbol[0];
        exchangeQty = Math.abs(Number(target?.qty ?? target?.size ?? 0));
      }
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `position_read_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (exchangeQty <= 0) {
      // Position vanished between decide and close — reconciler will
      // catch the DB row; nothing for us to close on-exchange.
      await pool.query(
        `UPDATE autonomous_trades SET status='closed', exit_price=$1, exit_time=NOW(),
                exit_reason='vanished_before_close', pnl=$2 WHERE id=$3`,
        [markPrice, pnlAtDecision, tradeId],
      ).catch(() => { /* non-fatal */ });
      return { executed: false, orderId: null, reason: 'exchange_position_vanished' };
    }

    // Lot-size round.
    let formattedSize = exchangeQty;
    let symbolLotSize = 0;
    try {
      const precisions = await getPrecisions(symbol);
      if (precisions.lotSize && precisions.lotSize > 0) {
        symbolLotSize = precisions.lotSize;
        formattedSize = Math.floor(exchangeQty / precisions.lotSize) * precisions.lotSize;
      }
    } catch { /* use raw */ }
    if (formattedSize <= 0) {
      return { executed: false, orderId: null, reason: 'lot_rounding_zero_on_close' };
    }

    const closeSide: 'buy' | 'sell' = heldSide === 'long' ? 'sell' : 'buy';

    // Poloniex v3 rejects single orders > 10,000 contracts with code 21010.
    // Live tape 2026-05-05 02:08 — and again 2026-05-06 00:20: BTC stale_bleed
    // retried every tick because the position had grown beyond the cap and
    // the close was permanently rejected.
    //
    // CRITICAL: Poloniex's 10,000 cap is in CONTRACTS, while ``formattedSize``
    // and ``symbolLotSize`` are in BASE ASSET (BTC, ETH) units. The
    // poloniexFuturesService.placeOrder converts ``size / lotSize → contracts``
    // internally before sending. So the chunker must reason in CONTRACTS, not
    // base asset — passing 1.5 BTC unchunked converts to 15,000 contracts and
    // hits 21010 even though "1.5" is far below the 9,999 base-asset threshold.
    //
    // Chunk in contracts space (lot=1), then convert each chunk back to base
    // asset for placeOrder by multiplying by symbolLotSize.
    //
    // Math.floor (not Math.round) for the conversion: if float precision
    // noise pushes formattedSize/symbolLotSize slightly above the true
    // integer (e.g., 15000.0000000001), rounding up would claim 15001
    // contracts the exchange doesn't actually have on the position, and
    // the reconciler's "exchange has positions not tracked in DB" branch
    // would have to clean up. Flooring under-closes by ≤ 1 contract worst
    // case — that residual is picked up by the reconciler's standard
    // ghost-close path on the next tick.
    const sizeInContracts = symbolLotSize > 0
      ? Math.floor(formattedSize / symbolLotSize)
      : Math.floor(formattedSize);
    const plan = planCloseChunks(sizeInContracts, 1);  // contracts, no lot rounding
    const chunkContracts = plan.chunks;
    if (plan.residual > 0) {
      const residualBaseAsset = symbolLotSize > 0
        ? plan.residual * symbolLotSize
        : plan.residual;
      logger.warn('[Monkey] close chunk residual stranded', {
        symbol,
        formattedSize,                  // base-asset (input from lot-rounding)
        symbolLotSize,
        sizeInContracts,                // contracts (post-conversion)
        residualContracts: plan.residual,
        residualBaseAsset,              // ditto, in base-asset for quick eyeballing
      });
    }
    if (chunkContracts.length === 0) {
      return { executed: false, orderId: null, reason: 'chunk_planning_zero' };
    }
    // Convert chunks back to base asset for placeOrder. lotSize=0 (legacy
    // path) keeps base-asset == contracts, preserving prior behavior.
    const chunkSizes = symbolLotSize > 0
      ? chunkContracts.map((c) => c * symbolLotSize)
      : chunkContracts;

    let orderId: string | null = null;
    try {
      // Proposal #10 — in HEDGE mode the close must specify which side
      // of the hedge book it's reducing, otherwise the exchange may
      // route against the wrong leg.
      //
      // HEDGE close: posSide=LONG|SHORT, NO reduceOnly — Poloniex v3
      // rejects reduceOnly in HEDGE with "Param error reduceOnly cannot
      // be set to true in hedge" (prod incident 2026-04-30). The
      // poloniexFuturesService strips reduceOnly for HEDGE mode, but we
      // also pass `positionMode` explicitly so the contract is obvious
      // at the call site.
      const isHedge = this.positionDirectionMode === 'HEDGE';
      const closePosSide: 'LONG' | 'SHORT' | undefined =
        isHedge ? (heldSide === 'long' ? 'LONG' : 'SHORT') : undefined;
      const orderIds: string[] = [];
      for (let i = 0; i < chunkSizes.length; i++) {
        const chunkSize = chunkSizes[i]!;
        const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
          symbol, side: closeSide, type: 'market', size: chunkSize, lotSize: symbolLotSize,
          reduceOnly: true,
        }, {
          positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
          ...(closePosSide ? { posSide: closePosSide } : {}),
        });
        const id =
          exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
          exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
        if (id) orderIds.push(String(id));
        if (chunkSizes.length > 1) {
          logger.info('[Monkey] close chunk placed', {
            symbol, chunk: i + 1, total: chunkSizes.length, size: chunkSize, orderId: id,
          });
        }
      }
      if (orderIds.length === 0) {
        return { executed: false, orderId: null, reason: 'no_chunk_returned_orderId' };
      }
      // Audit: when chunks > 1, expose the full chain so the close row's
      // exit_order_id reflects every leg. Single-order legacy keeps a single id.
      orderId = orderIds.length === 1 ? orderIds[0]! : orderIds.join(',');
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `close_exchange_rejected: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // v0.6.2: close ALL open monkey rows for this (kernel, symbol). DCA
    // adds created multiple rows for one logical position; the exchange
    // flattened them all in one market close above (size = total exchange
    // qty). Each row shares the realized pnl proportionally by quantity.
    //
    // Arbiter feedback: each row carries an agent tag (K|M); the PnL
    // share for that row goes back to the arbiter under that agent so
    // the rolling allocation reflects per-agent performance.
    try {
      // Proposal #10 — when a lane is scoped, only close that lane's
      // open rows. Other lanes (e.g. swing-long while we're closing a
      // scalp-short) keep their bookkeeping intact.
      const openRows = closeLane
        ? await pool.query(
            `SELECT id, quantity, agent FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                AND lane = $3
              ORDER BY entry_time ASC`,
            [`monkey|kernel=${this.instanceId}|%`, symbol, closeLane],
          )
        : await pool.query(
            `SELECT id, quantity, agent FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
              ORDER BY entry_time ASC`,
            [`monkey|kernel=${this.instanceId}|%`, symbol],
          );
      const rows = openRows.rows as Array<{ id: string; quantity: string; agent: string | null }>;
      const totalQty = rows.reduce((s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
      if (rows.length === 0 || totalQty === 0) {
        // Fallback — single-row close (covers edge case of race)
        await pool.query(
          `UPDATE autonomous_trades
              SET status = 'closed', exit_price = $1, exit_time = NOW(),
                  exit_reason = $2, exit_order_id = $3, pnl = $4
            WHERE id = $5`,
          [markPrice, exitReason, orderId, pnlAtDecision, tradeId],
        );
        // Single-row fallback: assume Agent K (the established default).
        this.arbiter.recordSettled('K', pnlAtDecision);
        // v0.8.8 per-agent reactive cognition: feed outcome to K's
        // emotion + neurochemistry stack (dopamine on win, frustration
        // on loss). See per_agent_state.ts.
        this.applyOutcomeToAgent(symbol, 'K', heldSide, pnlAtDecision);
      } else {
        for (const row of rows) {
          const qtyShare = Math.abs(Number(row.quantity) || 0) / totalQty;
          const rowPnl = pnlAtDecision * qtyShare;
          await pool.query(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, pnl = $4
              WHERE id = $5`,
            [markPrice, exitReason, orderId, rowPnl, row.id],
          );
          // Tag-aware arbiter feedback. Pre-separation rows have
          // agent=NULL or 'K' (default from migration 039); those
          // attribute to K. T (Turtle classical TA) was added in the
          // three-agent decomposition; ``recordSettled`` accepts any
          // uppercase label so T's PnL share goes back to T's window.
          // v0.8.8 — Agent L (FR-KNN classifier) joins the race.
          const agentLabel: AgentLabel =
            row.agent === 'M' ? 'M'
              : row.agent === 'T' ? 'T'
                : row.agent === 'L' ? 'L'
                  : 'K';
          this.arbiter.recordSettled(agentLabel, rowPnl);
          this.applyOutcomeToAgent(symbol, agentLabel, heldSide, rowPnl);
        }
      }
    } catch (err) {
      logger.error('[Monkey] close DB update failed — ORPHAN RISK (reconciler will catch)', {
        tradeId, err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('[Monkey] POSITION CLOSED', {
      symbol, heldSide, markPrice, orderId, tradeId,
      pnl: pnlAtDecision.toFixed(4), exitReason,
    });
    this.bus.publish({
      type: BusEventType.EXIT_TRIGGERED,
      source: this.instanceId,
      symbol,
      payload: { heldSide, markPrice, orderId, tradeId, pnl: pnlAtDecision, exitReason },
    });
    // v0.6.7 autonomic reward event. Margin ≈ markPrice × totalQty / lev
    // (she has only one kernel state; we use one of her symbol states
    // for κ). Pushed as an EVENT; computeNeurochemicals derives the
    // actual dopamine lift next tick.
    const symState = this.symbolStates.get(symbol);
    try {
      const totalQtyForMargin = exchangeQty || 0.01;
      const notional = markPrice * totalQtyForMargin;
      const margin = notional / Math.max(1, 16);  // typical lev on close; kappa boost uses exit κ
      this.pushReward({
        source: 'own_close',
        symbol,
        realizedPnlUsdt: pnlAtDecision,
        marginUsdt: margin,
        kappaAtExit: symState?.kappa,
      });
    } catch { /* non-fatal */ }
    return { executed: true, orderId, reason: 'closed' };
  }

export async function executeEntry(
    this: MonkeyKernel,req: {
    symbol: string;
    side: 'long' | 'short';
    marginUsdt: number;
    leverage: number;
    entryPrice: number;
    minNotional: number;
    phi: number;
    kappa: number;
    sovereignty: number;
    trajectoryId: number | null;
    /** v0.6.2: true when this is a DCA add, not an initial entry. */
    isDCAAdd?: boolean;
    /** 0 = initial entry; 1, 2, … for nth DCA add. */
    dcaAddIndex?: number;
    /** Which agent placed this entry. K = kernel (geometry-only),
     *  M = ml-only, T = Turtle System 1 classical TA (control arm).
     *  Default 'K' for back-compat with the existing call sites. */
    agent?: 'K' | 'M' | 'T' | 'L';
    /** Proposal #10: execution lane key. Default 'swing' = pre-#10 implicit
     *  lane so existing call sites remain bit-identical. */
    lane?: 'scalp' | 'swing' | 'trend';
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, side, marginUsdt, entryPrice, minNotional } = req;
    // 2026-05-13 — continuous-regime leverage sanity bound.
    //
    // Discrete mode leverage (50× EXPLORATION / 5× INTEGRATION) can
    // lag the actual market shape during regime transitions. The
    // continuous r ∈ [0,1] computed from velocity + chop + κ-criticality
    // produces a regimeSizing(r).leverage that responds tick-by-tick.
    // Use it as an UPPER BOUND on req.leverage so a mode-derived 50×
    // cannot fire when r says we're actually trending.
    const symStateForLev = this.symbolStates.get(symbol);
    const rNow = symStateForLev?.rScoreCurrent ?? null;
    let effectiveLeverage = req.leverage;
    let levBoundedReason = '';
    if (rNow !== null) {
      const continuous = computeRegimeSizing(rNow);
      if (continuous.leverage < effectiveLeverage) {
        levBoundedReason = `continuous_r=${rNow.toFixed(2)} caps ${effectiveLeverage}→${continuous.leverage}`;
        effectiveLeverage = continuous.leverage;
      }
    }
    if (levBoundedReason) {
      logger.info('[Monkey] continuous-regime leverage cap', {
        symbol, side, agent: req.agent ?? 'K', reason: levBoundedReason,
      });
    }
    const leverage = effectiveLeverage;
    const notionalUsdt = marginUsdt * leverage;
    const quantity = notionalUsdt / entryPrice;
    const exchangeSide: 'buy' | 'sell' = side === 'long' ? 'buy' : 'sell';

    // 2026-05-13 — CROSS-AGENT tape-disagreement veto.
    //
    // Observed 5/13 ~18:00-19:15Z: bot took -$68 in 3h by repeatedly
    // re-entering LONG ETH/BTC as both fell. Pattern: agent opens long
    // → tape drops → stack closes at -$18 → agent re-enters long 1s
    // later → tape still falling → another -$18 close.
    //
    // PR #663 added a tape+basin agreement gate to M only. K (geometric),
    // T (turtle), L (FR-KNN) all bypassed it. They're each individually
    // disciplined but none alone protect against "entering against the
    // tape." This gate is the cross-agent veto: regardless of which
    // agent proposes the entry, if tape is strongly against the side,
    // block it.
    //
    // Thresholds (env-tunable):
    //   long  vetoed when tape < -MONKEY_CROSS_AGENT_TAPE_VETO (default 0.20)
    //   short vetoed when tape > +MONKEY_CROSS_AGENT_TAPE_VETO
    //
    // Catches "actively going wrong way" only; weak disagreement
    // (|tape| < 0.20) still permits the entry. Each agent's own
    // discipline applies on top.
    const symState = this.symbolStates.get(symbol);
    const snap = symState?.latestBasinSnapshot;
    const SNAP_MAX_AGE_MS = 120_000;
    const snapAgeMs = snap ? Date.now() - snap.computedAtMs : Infinity;
    if (snap && snapAgeMs < SNAP_MAX_AGE_MS) {
      const tapeVetoThreshold =
        Number(process.env.MONKEY_CROSS_AGENT_TAPE_VETO) || 0.20;
      const tape = snap.tapeTrend;
      const blocked =
        (side === 'long' && tape < -tapeVetoThreshold) ||
        (side === 'short' && tape > tapeVetoThreshold);
      if (blocked) {
        logger.info('[Monkey] cross-agent tape veto', {
          symbol,
          side,
          agent: req.agent ?? 'K',
          tape: tape.toFixed(3),
          threshold: tapeVetoThreshold,
        });
        return {
          executed: false,
          orderId: null,
          reason: `cross_agent_tape_veto: tape=${tape.toFixed(3)} vs side=${side} (threshold ${tapeVetoThreshold})`,
        };
      }
    }

    // Load account + credentials like liveSignalEngine.loadAccountContext.
    let userId: string;
    let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
    let kernelState: KernelAccountState;
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
      if (!userId) return { executed: false, orderId: null, reason: 'no_credentials' };
      const c = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!c) return { executed: false, orderId: null, reason: 'credentials_missing' };
      credentials = c;
      const [balance, positions] = await Promise.all([
        poloniexFuturesService.getAccountBalance(credentials),
        poloniexFuturesService.getPositions(credentials),
      ]);
      const equityUsdt = Number(balance?.totalBalance ?? balance?.eq ?? 0);
      const unrealizedPnlUsdt = Number(balance?.unrealizedPnL ?? balance?.upl ?? 0);
      const openPositions = (Array.isArray(positions) ? positions : []).map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol ?? ''),
        // posSide-first side resolution. v3 HEDGE positions carry the
        // side in `posSide` (LONG/SHORT) with a positive `qty`; the old
        // `String(p.side ?? 'long')` read EVERY HEDGE position as long,
        // blinding the kernel's exposure / stacking vetoes on this path.
        side: resolveExchangePositionSide(p),
        // v3 positions have no `notional`/`size` field — derive from
        // im × lever via the shared resolver. The old `p.notional ??
        // p.size` read → 0 → checkPerSymbolExposure was blind to the
        // existing stack (see resolveExchangePositionNotional docstring).
        notional: resolveExchangePositionNotional(p),
      })).filter((p) => p.symbol.length > 0);
      // v0.8.8: thread used-margin telemetry to the kernel for the
      // headroom veto. Cross-margin: usedMargin = equity - availableBalance.
      // Falls back to 0 (kernel-side veto stays no-op) when the balance
      // feed doesn't expose availableBalance.
      const availableBalance = Number(
        balance?.availableBalance ?? balance?.availMgn ?? balance?.am ?? equityUsdt,
      );
      const usedMarginUsdt = Math.max(0, equityUsdt - availableBalance);
      kernelState = { equityUsdt, unrealizedPnlUsdt, openPositions, restingOrders: [], usedMarginUsdt };
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `account_load_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Risk kernel — same blast-door liveSignalEngine uses.
    const order: KernelOrder = { symbol, side, notional: notionalUsdt, leverage, price: entryPrice };
    const mode = await getCurrentExecutionMode();
    const symbolMaxLeverage = (await getMaxLeverage(symbol)) ?? leverage;
    // 2026-05-13 — pass monkeyMode through so risk kernel's headroom
    // check is regime-conditional (35% reserve EXPLORATION, 15% INTEGRATION).
    const monkeyMode = symState?.lastMode ?? undefined;
    const kernelContext: KernelContext = {
      isLive: mode === 'auto', mode, symbolMaxLeverage,
      monkeyMode: monkeyMode ?? undefined,
    };
    const decision = evaluatePreTradeVetoes(order, kernelState, kernelContext);
    if (!decision.allowed) {
      logger.info('[Monkey] kernel veto', {
        symbol, side, notional: notionalUsdt, leverage,
        code: decision.code, reason: decision.reason,
      });
      this.bus.publish({
        type: BusEventType.KERNEL_VETO,
        source: this.instanceId,
        symbol,
        payload: { side, notional: notionalUsdt, leverage, code: decision.code, reason: decision.reason },
      });
      return { executed: false, orderId: null, reason: `veto:${decision.code}:${decision.reason}` };
    }

    // Round quantity to the symbol's lot step. Same pattern liveSignalEngine
    // follows after the 2026-04-19 `Param error sz` incident.
    let formattedSize = quantity;
    let symbolLotSize = 0;
    try {
      const precisions = await getPrecisions(symbol);
      if (precisions.lotSize && precisions.lotSize > 0) {
        symbolLotSize = precisions.lotSize;
        formattedSize = Math.floor(quantity / precisions.lotSize) * precisions.lotSize;
      }
    } catch { /* use raw */ }
    if (formattedSize <= 0) {
      return {
        executed: false, orderId: null,
        reason: `lot_rounding_zero: qty ${quantity.toFixed(8)} below lot ${symbolLotSize}`,
      };
    }
    if (formattedSize * entryPrice < minNotional) {
      return {
        executed: false, orderId: null,
        reason: `post_round_below_min_notional: ${(formattedSize * entryPrice).toFixed(2)} < ${minNotional.toFixed(2)}`,
      };
    }

    // Per-position contracts cap (#11) — keep cumulative open contracts
    // for (agent, symbol, side, lane) below MAX_CONTRACTS_PER_POSITION
    // (default 8000, with 2000-contract buffer below Poloniex's 10000
    // per-order rejection threshold). When already-open contracts plus
    // this new entry's contracts would exceed the cap, clamp the new
    // entry; if no headroom, suppress the entry entirely. Independent
    // per-agent — K, M, T each get their own envelope.
    if (symbolLotSize > 0) {
      const effectiveAgent = (req.agent ?? 'K') as 'K' | 'M' | 'T';
      const effectiveLane = (req.lane ?? 'swing') as 'scalp' | 'swing' | 'trend';
      const newContracts = Math.floor(formattedSize / symbolLotSize);
      const currentContracts = await this.sumOpenContractsForPosition(
        symbol, effectiveAgent, side, effectiveLane, symbolLotSize,
      );
      const cap = getMaxContractsPerPosition();
      const clampedNewContracts = clampNewContractsToCap(
        newContracts, currentContracts, cap,
      );
      if (clampedNewContracts === 0) {
        logger.info('[Monkey] entry suppressed by contracts cap', {
          symbol, agent: effectiveAgent, side, lane: effectiveLane,
          currentContracts, attemptedNew: newContracts, cap,
        });
        return {
          executed: false, orderId: null,
          reason: `at_position_contracts_cap: open=${currentContracts} desired=${newContracts} cap=${cap}`,
        };
      }
      if (clampedNewContracts < newContracts) {
        logger.info('[Monkey] entry clamped by contracts cap', {
          symbol, agent: effectiveAgent, side, lane: effectiveLane,
          currentContracts, requested: newContracts,
          granted: clampedNewContracts, cap,
        });
        formattedSize = clampedNewContracts * symbolLotSize;
        // Re-check min notional with the clamped size; the cap may push
        // a small entry below the exchange minimum.
        if (formattedSize * entryPrice < minNotional) {
          return {
            executed: false, orderId: null,
            reason: `cap_clamp_below_min_notional: ${(formattedSize * entryPrice).toFixed(2)} < ${minNotional.toFixed(2)} (cap headroom too small)`,
          };
        }
      }
    }

    // Proposal #10 — when the live account is in HEDGE position-direction
    // mode, we MUST send `posSide: LONG | SHORT` so the exchange opens
    // the order on the correct side of the hedge book. In ONE_WAY mode,
    // omit posSide (the service defaults to BOTH). The mode is detected
    // once at startup (assertHedgeModeIfPossible) and cached on the
    // kernel; we read that cache here.
    const posSide: 'LONG' | 'SHORT' | undefined =
      this.positionDirectionMode === 'HEDGE'
        ? (req.side === 'long' ? 'LONG' : 'SHORT')
        : undefined;

    // Set leverage (non-fatal), then place market order.
    //
    // After the HEDGE-mode flip Poloniex returns code=11011
    // ("Position mode and posSide do not match") on /v3/position/leverage
    // when the body omits posSide (the default landed as BOTH, which is
    // an ONE_WAY-only value). Mirror the posSide derivation used for
    // placeOrder so the exchange sees a consistent side on both calls.
    try {
      await poloniexFuturesService.setLeverage(
        credentials, symbol, leverage,
        posSide ? { posSide } : {},
      );
    } catch (levErr) {
      logger.warn('[Monkey] setLeverage failed (non-fatal)', {
        symbol, leverage, posSide,
        err: levErr instanceof Error ? levErr.message : String(levErr),
      });
    }

    let orderId: string | null = null;
    try {
      const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
        symbol, side: exchangeSide, type: 'market', size: formattedSize, lotSize: symbolLotSize,
      }, posSide ? { posSide } : {});
      orderId =
        exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
        exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
      if (!orderId) {
        logger.warn('[Monkey] exchange placed but no orderId returned', {
          symbol, rawKeys: exchangeOrder ? Object.keys(exchangeOrder) : [],
        });
      }
    } catch (err) {
      logger.error('[Monkey] placeOrder failed', {
        symbol, side, err: err instanceof Error ? err.message : String(err),
      });
      return {
        executed: false, orderId: null,
        reason: `exchange_rejected: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Persist. Encode kernel + agent + lane + Monkey's state into reason
    // so the close-hook + reconciler + arbiter can recover attribution
    // cheaply.
    // Format: monkey|kernel=<id>|agent=<K|M>|lane=<scalp|swing|trend>|phi=...|kappa=...|sov=...|dca=<N>|src=<ver>
    const agentTag = req.agent ?? 'K';
    const laneTag = req.lane ?? 'swing';
    try {
      const dcaTag = req.isDCAAdd ? `|dca=${req.dcaAddIndex ?? 1}` : '';
      const reasonEncoded =
        `monkey|kernel=${this.instanceId}|agent=${agentTag}|lane=${laneTag}|phi=${req.phi.toFixed(3)}|kappa=${req.kappa.toFixed(2)}|sov=${req.sovereignty.toFixed(3)}${dcaTag}|src=v0.10`;
      await pool.query(
        `INSERT INTO autonomous_trades
           (user_id, symbol, side, entry_price, quantity, leverage,
            confidence, reason, order_id, paper_trade, engine_version, agent, lane)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          userId, symbol, exchangeSide, entryPrice, formattedSize, leverage,
          req.phi, reasonEncoded, orderId, false, getEngineVersion(), agentTag, laneTag,
        ],
      );
    } catch (err) {
      logger.error('[Monkey] DB insert failed after exchange placement — ORPHAN RISK', {
        orderId, err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info(req.isDCAAdd ? '[Monkey] DCA_ADD PLACED' : '[Monkey] ORDER PLACED', {
      symbol, side, orderId,
      margin: marginUsdt.toFixed(2),
      notional: notionalUsdt.toFixed(2),
      leverage,
      formattedSize,
      phi: req.phi.toFixed(3),
      sov: req.sovereignty.toFixed(3),
      dcaAddIndex: req.dcaAddIndex ?? 0,
    });

    this.bus.publish({
      type: BusEventType.ENTRY_EXECUTED,
      source: this.instanceId,
      symbol,
      payload: {
        side, orderId, margin: marginUsdt, notional: notionalUsdt, leverage,
        entryPrice, phi: req.phi, kappa: req.kappa, sovereignty: req.sovereignty,
        isDCAAdd: Boolean(req.isDCAAdd), dcaAddIndex: req.dcaAddIndex ?? 0,
      },
    });

    return { executed: true, orderId, reason: 'placed' };
  }

export async function witnessExit(
    this: MonkeyKernel,
    symbol: string,
    entryTime: Date,
    realizedPnl: number,
    orderId: string | null,
    side: 'long' | 'short',
  ): Promise<void> {
    // Dedup guard — close path races reconciler. Skip if we've already
    // run witnessExit for this orderId within the window. Same orderId-
    // dedup pattern as resonance_bank.writeBubble (#575); this layer
    // catches the race before the gate / bank are touched at all.
    if (orderId) {
      const now = Date.now();
      const submittedAt = this.witnessExitDedup.get(orderId);
      if (submittedAt != null && now - submittedAt < WITNESS_DEDUP_WINDOW_MS) {
        logger.info('[Monkey] witnessExit deduplicated', {
          orderId,
          age_ms: now - submittedAt,
        });
        return;
      }
      this.witnessExitDedup.set(orderId, now);
      // Lazy prune of expired entries (cap unbounded growth).
      if (this.witnessExitDedup.size > 256) {
        const cutoff = now - WITNESS_DEDUP_WINDOW_MS;
        for (const [oid, ts] of this.witnessExitDedup) {
          if (ts < cutoff) this.witnessExitDedup.delete(oid);
        }
      }
    }
    try {
      const row = await pool.query(
        `SELECT basin, phi
           FROM monkey_trajectory
          WHERE symbol = $1 AND at <= $2
          ORDER BY at DESC LIMIT 1`,
        [symbol, entryTime],
      );
      const rec = row.rows[0] as { basin: number[] | string; phi: number } | undefined;
      if (!rec) {
        logger.debug('[Monkey] witnessExit: no trajectory found for entry', {
          symbol, entryTime: entryTime.toISOString(),
        });
        return;
      }
      const basinArr = typeof rec.basin === 'string' ? JSON.parse(rec.basin) : rec.basin;
      const entryBasin: Basin = Float64Array.from(basinArr);
      const phi = Number(rec.phi) || 0.5;

      // Loop 3 (UCP §43.4) — gate the bank write. Pulls the Loop 1
      // sovereignty + Loop 2 convergence_type recorded on the trade
      // row at open time. Pre-refactor rows have NULL columns; the
      // gate then defaults to permissive (sovereignty=0.5, consensus)
      // so legacy rows still write.
      const triple = await pool
        .query(
          `SELECT sovereignty_score, convergence_type, created_at, exit_time
             FROM autonomous_trades
            WHERE order_id = $1
            ORDER BY created_at DESC LIMIT 1`,
          [orderId ?? ''],
        )
        .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
      const tripleRow = triple.rows[0] as
        | {
            sovereignty_score?: number | null;
            convergence_type?: string | null;
            created_at?: Date | null;
            exit_time?: Date | null;
          }
        | undefined;
      const sovereigntyScore =
        tripleRow?.sovereignty_score == null ? 0.5 : Number(tripleRow.sovereignty_score);
      const convergenceType =
        (tripleRow?.convergence_type as
          | 'consensus' | 'groupthink' | 'genuine_multi' | 'non_convergent'
          | undefined) ?? 'consensus';
      const tradeOpenMs =
        tripleRow?.created_at != null ? new Date(tripleRow.created_at).getTime() : entryTime.getTime();
      const tradeCloseMs =
        tripleRow?.exit_time != null ? new Date(tripleRow.exit_time).getTime() : Date.now();
      const tradeDurationS = Math.max(0, (tradeCloseMs - tradeOpenMs) / 1000);
      const gateDecision = await evaluateBankWrite({
        symbol,
        decisionId: orderId ?? `witness-${Date.now()}`,
        sovereigntyScore,
        convergenceType,
        tradePnlUsdt: realizedPnl,
        tradeDurationS,
      });
      if (!gateDecision.approved) {
        logger.info('[Monkey] learning_gate rejected witnessExit bank write', {
          symbol, orderId, side, pnl: realizedPnl.toFixed(4),
          reasons: gateDecision.reasons,
        });
        return;
      }

      // Synthesize a bubble that looks like it was promoted from WM
      // with the outcome attached. Bypass working memory — the bubble
      // is already resolved.
      const bubble: Bubble = {
        id: `witness-${orderId ?? Date.now()}`,
        center: entryBasin,
        phi,
        createdAt: entryTime.getTime(),
        lifetimeMs: 0,
        status: 'promoted',
        metadata: { source: 'live_signal_witness', orderId },
        payload: {
          symbol,
          signal: side === 'long' ? 'BUY' : 'SELL',
          realizedPnl,
          entryBasin,
          orderId: orderId ?? undefined,
        },
      };
      const written = await resonanceBank.writeBubble(bubble, getEngineVersion());
      if (written) {
        logger.info('[Monkey] witnessExit → bank', {
          symbol, orderId, side, pnl: realizedPnl.toFixed(4),
          entryTime: entryTime.toISOString(),
        });

        // PR 3 (#608) — FORGE_BANK_WRITE_LIVE flag wiring.
        // Detect shadow material (large loss relative to a typical
        // ~$5 margin) → run Forge cycle → write nucleus + quarantine
        // original. With flag off, log forge output but don't write.
        const marginEstimate = 5.0;
        const pnlFraction = marginEstimate > 0 ? realizedPnl / marginEstimate : 0;
        if (pnlFraction < shadowThreshold()) {
          const forgeResult = forge({
            basin: entryBasin,
            phi,
            kappa: KAPPA_STAR, // anchor — exact κ at exit not preserved
            realizedPnl,
            regimeWeights: { quantum: 1 / 3, efficient: 1 / 3, equilibrium: 1 / 3 },
          });
          if (forgeBankWriteLive()) {
            // Persist nucleus as new bubble; quarantine the original.
            const nucleus = await resonanceBank.writeForgedNucleus(
              forgeResult.nucleated.basin,
              {
                symbol,
                phi,
                lane: (bubble.payload?.lane ?? 'swing') as 'scalp' | 'swing' | 'trend' | 'observe',
                forgedFromOrderId: orderId,
                lossMagnitude: Math.abs(realizedPnl),
                engineVersion: getEngineVersion(),
              },
            );
            const quarantined = await resonanceBank.markQuarantined(
              written.id,
              `forged_nucleus_id=${nucleus?.id ?? 'unknown'}`,
            );
            logger.info('[Monkey.Forge] shadow → nucleus written', {
              symbol, orderId, pnlFraction: pnlFraction.toFixed(4),
              lossMagnitude: Math.abs(realizedPnl).toFixed(4),
              nucleusId: nucleus?.id, quarantinedOriginal: quarantined,
            });
          } else {
            logger.info('[Monkey.Forge] shadow detected (flag off, observe-only)', {
              symbol, orderId, pnlFraction: pnlFraction.toFixed(4),
              wouldNucleate: true,
              shapeConcentration: forgeResult.lessonSummary.shape_concentration,
              kappaOffset: forgeResult.lessonSummary.kappa_offset,
            });
          }
        }

        this.bus.publish({
          type: BusEventType.BANK_WRITE,
          source: this.instanceId,
          symbol,
          payload: { orderId, side, realizedPnl, entryTime: entryTime.toISOString() },
        });
        this.bus.publish({
          type: BusEventType.OUTCOME,
          source: this.instanceId,
          symbol,
          payload: { orderId, side, realizedPnl, win: realizedPnl > 0 },
        });
        // v0.6.7: witnessed liveSignal closes are also reinforcement
        // events — her bank learned from them, so her NC should too.
        // Dampen the reward magnitude since it wasn't her trade (she
        // just observed). Estimate margin from typical liveSignal
        // position (~$5 at 16x).
        this.pushReward({
          source: 'witnessed_liveSignal',
          symbol,
          realizedPnlUsdt: realizedPnl * 0.5,  // half-weight (witnessed, not her own)
          marginUsdt: 5,
        });
      }
    } catch (err) {
      logger.debug('[Monkey] witnessExit failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
