/**
 * signalScorer.test.ts — QIG-FR v4 Problem 4 raw-signal scorer.
 *
 * Covers:
 *   1. resolveEntryGate priority chain mirrors the loop.ts gate order
 *   2. shortRejectCode reduces executeEntry rejections to stable codes
 *   3. record skips flat predictions (no direction = nothing to score)
 *   4. scoreMatured does not score before the measurement horizon
 *   5. scoreMatured scores at the horizon — long/short win/loss logic
 *   6. per-gate attribution lands in the snapshot
 */

import { describe, it, expect } from 'vitest';
import {
  SignalScorer,
  resolveEntryGate,
  shortRejectCode,
  type GateFacts,
} from '../signal_scorer.js';

const HORIZON = 6; // mirrors SCORE_HORIZON_TICKS in signal_scorer.ts

function facts(over: Partial<GateFacts>): GateFacts {
  return {
    executed: false,
    heldSide: null,
    modeCanEnter: true,
    sideShortRefused: false,
    sizeValue: 100,
    executeEnabled: true,
    tradingPaused: false,
    lVetoed: false,
    cappedMargin: 100,
    entryRejectCode: null,
    ...over,
  };
}

describe('resolveEntryGate', () => {
  it('returns passed when an order executed', () => {
    expect(resolveEntryGate(facts({ executed: true }))).toBe('passed');
  });

  it('returns position_open when a position is already held', () => {
    expect(resolveEntryGate(facts({ heldSide: 'long' }))).toBe('position_open');
  });

  it('honours the gate priority order', () => {
    expect(resolveEntryGate(facts({ modeCanEnter: false }))).toBe('mode');
    expect(resolveEntryGate(facts({ sideShortRefused: true }))).toBe('short_refused');
    expect(resolveEntryGate(facts({ sizeValue: 0 }))).toBe('min_notional');
    expect(resolveEntryGate(facts({ executeEnabled: false }))).toBe('observe_only');
    expect(resolveEntryGate(facts({ tradingPaused: true }))).toBe('trading_paused');
    expect(resolveEntryGate(facts({ lVetoed: true }))).toBe('l_veto');
    expect(resolveEntryGate(facts({ cappedMargin: 0 }))).toBe('arbiter_zero');
  });

  it('labels executeEntry rejections with the short code', () => {
    expect(
      resolveEntryGate(facts({ entryRejectCode: 'veto:margin_headroom:Margin headroom 14%' })),
    ).toBe('exec:margin_headroom');
  });

  it('returns no_entry when nothing gated and nothing executed', () => {
    expect(resolveEntryGate(facts({}))).toBe('no_entry');
  });

  it('executed wins over every other condition', () => {
    expect(
      resolveEntryGate(facts({ executed: true, heldSide: 'long', tradingPaused: true })),
    ).toBe('passed');
  });
});

describe('shortRejectCode', () => {
  it('extracts the code from a veto:<code>:<msg> string', () => {
    expect(shortRejectCode('veto:margin_headroom:Margin headroom 14%')).toBe('margin_headroom');
    expect(shortRejectCode('veto:funding:funding rate too high')).toBe('funding');
  });

  it('falls back to the first token for non-veto strings', () => {
    expect(shortRejectCode('k_arbiter_zero')).toBe('k_arbiter_zero');
    expect(shortRejectCode('min notional 77.3')).toBe('min');
  });
});

describe('SignalScorer', () => {
  const key = { instanceId: 'monkey-position', symbol: 'BTC_USDT_PERP' };

  it('skips flat predictions — nothing to score', () => {
    const s = new SignalScorer();
    s.record({ ...key, tick: 0, price: 100, direction: 'flat', gate: 'passed' });
    s.scoreMatured({ ...key, tick: HORIZON, price: 200 });
    expect(s.snapshot().raw.n).toBe(0);
  });

  it('does not score a prediction before the measurement horizon', () => {
    const s = new SignalScorer();
    s.record({ ...key, tick: 0, price: 100, direction: 'long', gate: 'passed' });
    s.scoreMatured({ ...key, tick: HORIZON - 1, price: 110 });
    expect(s.snapshot().raw.n).toBe(0);
  });

  it('scores a long prediction as a win when price rose', () => {
    const s = new SignalScorer();
    s.record({ ...key, tick: 0, price: 100, direction: 'long', gate: 'passed' });
    s.scoreMatured({ ...key, tick: HORIZON, price: 110 });
    expect(s.snapshot().raw).toEqual({ wr: 1, n: 1 });
  });

  it('scores a long prediction as a loss when price fell', () => {
    const s = new SignalScorer();
    s.record({ ...key, tick: 0, price: 100, direction: 'long', gate: 'passed' });
    s.scoreMatured({ ...key, tick: HORIZON, price: 90 });
    expect(s.snapshot().raw).toEqual({ wr: 0, n: 1 });
  });

  it('scores a short prediction as a win when price fell', () => {
    const s = new SignalScorer();
    s.record({ ...key, tick: 0, price: 100, direction: 'short', gate: 'min_notional' });
    s.scoreMatured({ ...key, tick: HORIZON, price: 90 });
    expect(s.snapshot().raw).toEqual({ wr: 1, n: 1 });
  });

  it('attributes wins and losses to the suppressing gate', () => {
    const s = new SignalScorer();
    // price rises 100 → 120 over the horizon:
    //  - a min_notional-gated LONG would have won
    //  - an l_veto-gated SHORT would have lost
    s.record({ ...key, tick: 0, price: 100, direction: 'long', gate: 'min_notional' });
    s.record({ ...key, tick: 0, price: 100, direction: 'short', gate: 'l_veto' });
    s.scoreMatured({ ...key, tick: HORIZON, price: 120 });

    const gates = s.snapshot().gates;
    const minNotional = gates.find((g) => g.gate === 'min_notional');
    const lVeto = gates.find((g) => g.gate === 'l_veto');
    expect(minNotional).toEqual({ gate: 'min_notional', wr: 1, n: 1 });
    expect(lVeto).toEqual({ gate: 'l_veto', wr: 0, n: 1 });
    // raw aggregate spans both: one win, one loss
    expect(s.snapshot().raw).toEqual({ wr: 0.5, n: 2 });
  });

  it('keeps separate kernel instances from cross-contaminating', () => {
    const s = new SignalScorer();
    s.record({ instanceId: 'monkey-position', symbol: 'BTC_USDT_PERP', tick: 0, price: 100, direction: 'long', gate: 'passed' });
    // a different instance maturing at the horizon must not score the
    // monkey-position prediction
    s.scoreMatured({ instanceId: 'monkey-swing', symbol: 'BTC_USDT_PERP', tick: HORIZON, price: 999 });
    expect(s.snapshot().raw.n).toBe(0);
    s.scoreMatured({ instanceId: 'monkey-position', symbol: 'BTC_USDT_PERP', tick: HORIZON, price: 110 });
    expect(s.snapshot().raw.n).toBe(1);
  });
});
