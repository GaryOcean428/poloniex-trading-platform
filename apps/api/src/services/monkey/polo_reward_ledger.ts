/**
 * polo_reward_ledger.ts — pure helper for the Polo-authoritative reward
 * ledger PnL computation (#1024).
 *
 * Extracts the gross + close-fees + open-fees + funding composition out
 * of `applyPoloRealizedPnlAfterClose` so the money-path math can be
 * unit-tested in isolation. Loop.ts pulls in env validation + DB + Polo
 * service, which kills the test environment; this helper is pure.
 *
 * # Reward-ledger composition
 *
 *   pnl_net_close_fees_only = gross − close_fees
 *   pnl_net_full            = pnl_net_close_fees_only − open_fees + funding_net_signed
 *
 * Note the SIGN on funding: the canonical Poloniex convention for the
 * `fundingFee` field on `/v3/trade/funding` is the user's SIGNED cash
 * flow.
 *
 *   user PAID funding   → fundingFee < 0 (loss)
 *   user RECEIVED funding → fundingFee > 0 (gain)
 *
 * So the per-event signed amount ALREADY carries the direction; we ADD
 * the sum directly to net (a paid event with negative amount correctly
 * reduces the net). Subtracting `totalFundingFlows` (as the previous
 * draft did) inverts that — paid-funding events end up INCREASING the
 * net while received-funding events DECREASE it. This helper fixes the
 * math.
 *
 * Cross-check at the call site: the existing pre-entry funding gate in
 * `loop.ts` documents the rate convention as "side=long pays when
 * fundingRate8h > 0; side=short pays when fundingRate8h < 0". The
 * `fundingFee` field on the history endpoint is the cash flow
 * RESULTING from that rate; sign follows the user's account.
 *
 * # pnl_source enum
 *
 *   'polo_gross_minus_close_fees' — close fees subtracted, but open-side
 *      fees and funding NOT included (either not indexed yet, or this
 *      account doesn't have them populated). Honest provenance.
 *   'polo_net_full' — close fees + open fees + signed funding all
 *      included; this is the closest the reward channel gets to true
 *      economic net pnl from a kernel-issued close.
 *
 * `hasFullNet` requires BOTH the open-side fee fills indexed AND the
 * funding fetch succeeded. Either one missing → fall back to
 * `polo_gross_minus_close_fees`. The `pnl_net_full` column is still
 * populated when partial (so operators can inspect what's available),
 * but the reward channel consumes only the authoritative value
 * (`poloRealized`).
 *
 * Citations: poloniex-trading-platform#1015 + #1024 (this PR) + Cascade
 * 2026-05-29 review (funding sign concern) + #992 polo-authoritative
 * canonical surface + 2.31A P5/P25 + QIG PURITY MANDATE.
 */

export type PoloPnlSource =
  | 'polo_gross_minus_close_fees'
  | 'polo_net_full';

export interface PoloRewardInputs {
  /** Sum of per-fill grossPnl on the close orders (signed). */
  grossSum: number;
  /** Sum of |feeAmt| on close-side fills (magnitude — fees are costs). */
  totalCloseFees: number;
  /** Sum of |feeAmt| on open-side fills (magnitude — fees are costs). */
  totalOpenFees: number;
  /** True when open-side fee fills were ALL indexed (i.e. complete). */
  openFeesComplete: boolean;
  /** Sum of SIGNED `fundingFee` from `/v3/trade/funding` rows over the
   * position window. Sign is the user's cash flow direction (positive
   * = received, negative = paid). */
  fundingFlowsSigned: number;
  /** True when the funding fetch succeeded (success even if zero rows
   * — empty window is a legitimate zero, not an "unknown"). */
  fundingComplete: boolean;
}

export interface PoloRewardOutput {
  /** Close fees only — always populated as a fallback. */
  pnlNetCloseFeesOnly: number;
  /** Full net including open fees + signed funding. Populated even
   * when partial (open fees may be incomplete) so operators can audit
   * the partial composition. */
  pnlNetFull: number;
  /** True when BOTH open fees AND funding fetched cleanly. */
  hasFullNet: boolean;
  /** The single number to feed into the reward channel + write to
   * autonomous_trades.pnl. */
  poloRealized: number;
  /** Provenance tag. Tracks what was actually composed into
   * `poloRealized`. */
  pnlSource: PoloPnlSource;
}

export function computePoloAuthoritativeReward(
  inputs: PoloRewardInputs,
): PoloRewardOutput {
  const pnlNetCloseFeesOnly = inputs.grossSum - inputs.totalCloseFees;
  // ADD signed funding flow (NOT subtract). The signed value already
  // carries direction: paid funding (negative) reduces net, received
  // funding (positive) increases net. See module docstring.
  const pnlNetFull =
    pnlNetCloseFeesOnly - inputs.totalOpenFees + inputs.fundingFlowsSigned;
  const hasFullNet = inputs.openFeesComplete && inputs.fundingComplete;
  const pnlSource: PoloPnlSource = hasFullNet
    ? 'polo_net_full'
    : 'polo_gross_minus_close_fees';
  const poloRealized = hasFullNet ? pnlNetFull : pnlNetCloseFeesOnly;
  return {
    pnlNetCloseFeesOnly,
    pnlNetFull,
    hasFullNet,
    poloRealized,
    pnlSource,
  };
}

/**
 * Funding sign discrepancy check — returns a list of rows whose
 * `fundingFee` sign disagrees with the expected direction implied by
 * (position side, funding rate sign). Used to surface API convention
 * drift in production logs without breaking the reward channel.
 *
 * Expected direction (per the kernel's pre-entry funding gate
 * documentation in `loop.ts`):
 *   side=long  + rate > 0 → user PAYS  → fundingFee < 0
 *   side=long  + rate < 0 → user RECEIVES → fundingFee > 0
 *   side=short + rate > 0 → user RECEIVES → fundingFee > 0
 *   side=short + rate < 0 → user PAYS  → fundingFee < 0
 */
export interface FundingRow {
  fundingFee: number;
  rate: number;
}

export interface FundingSignDiscrepancy {
  fundingFee: number;
  rate: number;
  expectedSign: 'paid' | 'received';
  actualSign: 'paid' | 'received' | 'zero';
}

export function detectFundingSignDiscrepancies(
  side: 'long' | 'short',
  rows: FundingRow[],
): FundingSignDiscrepancy[] {
  const out: FundingSignDiscrepancy[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.fundingFee) || !Number.isFinite(row.rate)) continue;
    if (row.rate === 0 || row.fundingFee === 0) continue;
    const userPaysByRate =
      (side === 'long' && row.rate > 0) || (side === 'short' && row.rate < 0);
    const expectedSign: 'paid' | 'received' = userPaysByRate ? 'paid' : 'received';
    const actualSign: 'paid' | 'received' = row.fundingFee < 0 ? 'paid' : 'received';
    if (expectedSign !== actualSign) {
      out.push({
        fundingFee: row.fundingFee,
        rate: row.rate,
        expectedSign,
        actualSign,
      });
    }
  }
  return out;
}

/**
 * Authoritative realized-PnL + funding composition from `/v3/account/bills`
 * (poloniex-trading-platform#1028).
 *
 * Poloniex account bills are literal USDT cash movements per row:
 *   type 'PNL'         — realized price PnL of a close fill (signed `sz`)
 *   type 'FUNDING_FEE' — funding cash flow (signed `sz`: + received, − paid)
 *   type 'TRANSFER'    — deposits/withdrawals (NOT a trade outcome; excluded)
 *
 * Verified 2026-05-29 against the live polytrade-be account: summing the
 * `type=PNL` rows over the close-fill window reconciles EXACTLY to the
 * exchange-exported closed PnL (ETH −4.2499 from 8 rows; BTC −2.243525 from
 * 4 rows). The prior path self-computed a synthetic per-row gross that
 * under-counted (ETH reported −3.5568), and pulled funding from
 * `/v3/trade/funding` — which does not exist (404). Funding lives in
 * FUNDING_FEE bills.
 *
 * Bills carry no `ordId`, so PNL rows are matched by symbol + a tight cTime
 * window around the close fills (PNL bill cTime == close fill cTime), and
 * funding rows by the position hold window [entry, close].
 */
export interface PoloBillRow {
  /** Bill type: 'PNL' | 'FUNDING_FEE' | 'TRANSFER' | ... */
  type: string;
  /** Signed USDT cash movement for this bill row. */
  sz: number;
  /** Normalized symbol, e.g. ETH_USDT_PERP. */
  symbol: string;
  /** Bill creation time in epoch ms. */
  cTimeMs: number;
}

export interface PoloBillsComposition {
  /** Σ of `type=PNL` `sz` within the close window — authoritative realized PnL. */
  realizedPnl: number;
  /** Σ of `type=FUNDING_FEE` `sz` within the hold window (+ received, − paid). */
  fundingSigned: number;
  /** Count of PNL rows matched (0 → caller must NOT trust realizedPnl; fall back). */
  pnlRowCount: number;
  /** Count of FUNDING_FEE rows matched. */
  fundingRowCount: number;
}

export function composePoloBillsReward(
  rows: PoloBillRow[],
  opts: {
    symbol: string;
    /** Tight window around the close fills (inclusive, epoch ms). */
    closeStartMs: number;
    closeEndMs: number;
    /** Position hold window for funding attribution (inclusive, epoch ms). */
    holdStartMs: number;
    holdEndMs: number;
  },
): PoloBillsComposition {
  let realizedPnl = 0;
  let fundingSigned = 0;
  let pnlRowCount = 0;
  let fundingRowCount = 0;
  for (const r of rows) {
    if (r.symbol !== opts.symbol) continue;
    if (!Number.isFinite(r.sz) || !Number.isFinite(r.cTimeMs)) continue;
    if (r.type === 'PNL' && r.cTimeMs >= opts.closeStartMs && r.cTimeMs <= opts.closeEndMs) {
      realizedPnl += r.sz;
      pnlRowCount += 1;
    } else if (
      r.type === 'FUNDING_FEE' &&
      r.cTimeMs >= opts.holdStartMs &&
      r.cTimeMs <= opts.holdEndMs
    ) {
      fundingSigned += r.sz;
      fundingRowCount += 1;
    }
  }
  return { realizedPnl, fundingSigned, pnlRowCount, fundingRowCount };
}

/**
 * External-close reward decision (the "operator-close hole" — #1033).
 *
 * Externally/operator-closed positions (closed in the exchange UI, or by a
 * CC/operator exemplar trade — NOT by a kernel-issued close order) currently
 * feed realized PnL into bookkeeping (`autonomous_trades.pnl` via the
 * reconciler) but DO NOT feed the kernel's reward chemistry. The kernel's own
 * close path (`applyPoloRealizedPnlAfterClose`, keyed on the kernel's own
 * `closeOrderIds`) is the only thing that fires `pushReward` /
 * `callAutonomicReward` today. So operator/CC exemplar trades teach nothing.
 *
 * This pure helper decides — for a SINGLE ghost-closed row the reconciler is
 * about to finalize — whether to ALSO route its realized PnL into the reward
 * chemistry, and with what magnitude. The reconciler does the DB/Polo I/O and
 * the bus publish; this function holds the (testable) policy so the decision
 * is unit-pinnable without the DB/Polo/env machinery.
 *
 * # Guards encoded here (mirrors the task spec)
 *
 * 1. NO DOUBLE-COUNT vs the kernel's own close path. A kernel-issued close
 *    that lands late is tagged `reconciled_post_close_race` by the reconciler
 *    (it carries an `exit_order_id`); its reward already fired on the kernel's
 *    own path. ONLY `manual_close_user` (operator/CC external close) is
 *    eligible here. Any other ghostReason → not eligible.
 * 2. FLAG-GATED. `enabled=false` (flag OFF) → never eligible → byte-identical
 *    to today's bookkeeping-only behaviour.
 * 3. AUTHORITATIVE MAGNITUDE. The reward magnitude is the bills-authoritative
 *    realized PnL (`/v3/account/bills` `type=PNL` sum, #1028) — the SAME
 *    surface the kernel's own close path consumes. The lossy ±90s
 *    position-history match is NOT used for reward. If no PNL bill rows
 *    matched (`pnlBillRowCount <= 0`), we decline rather than reward a
 *    synthetic/guessed magnitude (better to miss a lesson than teach a wrong
 *    one).
 * 4. AGENT-OWNED. Only K/M/T/L-attributed rows feed an agent's chemistry.
 *    A null/unknown agent → not eligible (nothing to attribute to).
 */
export type ExternalCloseRewardEligibility =
  | {
      eligible: true;
      /** Bills-authoritative realized PnL to feed the reward chemistry. */
      realizedPnl: number;
      /** Provenance tag for the OUTCOME publish + telemetry. */
      pnlSource: 'polo_bills_external_close';
    }
  | {
      eligible: false;
      /** Why the reward was declined (telemetry/debugging only). */
      reason:
        | 'flag_off'
        | 'not_external_close'
        | 'no_agent'
        | 'no_bills_pnl'
        | 'non_finite_pnl';
    };

export function decideExternalCloseReward(input: {
  /** `MONKEY_REWARD_EXTERNAL_CLOSES_LIVE === 'true'`. */
  enabled: boolean;
  /** The reconciler's ghost reason for this row. */
  ghostReason: string;
  /** The owning agent, or null if unattributed. */
  agent: 'K' | 'M' | 'T' | 'L' | null;
  /** Σ of `type=PNL` bill `sz` over the close window. */
  billsRealizedPnl: number;
  /** Count of PNL bill rows matched (0 → no authoritative magnitude). */
  pnlBillRowCount: number;
}): ExternalCloseRewardEligibility {
  if (!input.enabled) return { eligible: false, reason: 'flag_off' };
  // Guard 1: ONLY operator/CC external closes. `reconciled_post_close_race`
  // (kernel's own late-landing close) and any other reason are excluded so a
  // kernel-own close can never be double-rewarded here.
  if (input.ghostReason !== 'manual_close_user') {
    return { eligible: false, reason: 'not_external_close' };
  }
  // Guard 4: must attribute to an agent's chemistry.
  if (input.agent === null) return { eligible: false, reason: 'no_agent' };
  // Guard 3: authoritative magnitude only.
  if (input.pnlBillRowCount <= 0) return { eligible: false, reason: 'no_bills_pnl' };
  if (!Number.isFinite(input.billsRealizedPnl)) {
    return { eligible: false, reason: 'non_finite_pnl' };
  }
  return {
    eligible: true,
    realizedPnl: input.billsRealizedPnl,
    pnlSource: 'polo_bills_external_close',
  };
}
