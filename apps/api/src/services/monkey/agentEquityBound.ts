/**
 * agentEquityBound.ts — per-agent equity discipline.
 *
 * The Arbiter splits total equity into per-agent allocations (K-share,
 * M-share, T-share via PnL softmax). What was missing until 2026-05-05:
 * a check that an agent's cumulative open margin stays within the
 * allocation it was granted. Without that bound, Agent M (the ML
 * control arm, which has no lane discipline like K and no Donchian
 * pyramid like T) can stack fresh entries every tick the ML signal
 * stays above its threshold — observed 13 ETH longs in 16 minutes
 * before Poloniex's 21005 margin-insufficient error caught it.
 *
 * The fix preserves agent independence: K, M, and T each operate
 * under their own discipline. The bound only constrains *the agent
 * itself* — it never reaches across to gate one agent based on
 * another's positions.
 *
 * Self-regulating: when the agent is profitable, the Arbiter softmax
 * grants more capital → cap loosens. When the agent loses, allocation
 * shrinks → cap tightens. The bound rides the agent's own track record.
 *
 * Pure functions only — DB queries live on the kernel side.
 */

/**
 * Available margin for new entries — the gap between the Arbiter's
 * per-tick allocation and the agent's currently-committed margin.
 * Floored at zero (a negative value means the agent is already over
 * its allocation; new entries should be suppressed, but existing
 * positions ride out their own exit logic).
 */
export function computeAgentHeadroom(
  allocation: number,
  openMargin: number,
): number {
  if (!Number.isFinite(allocation) || !Number.isFinite(openMargin)) return 0;
  return Math.max(0, allocation - openMargin);
}

/**
 * Clamp a desired entry size to fit within remaining headroom. The
 * decide() function in ml_agent already caps at allocation × 0.5,
 * but headroom is the strict-tighter bound when prior entries have
 * consumed most of the allocation.
 *
 * Returns 0 (no entry) when headroom is non-positive or the desired
 * size is non-positive, so callers can use the result directly in
 * "if (clamped > 0)" guards.
 */
export function clampSizeToHeadroom(
  desiredSizeUsdt: number,
  headroom: number,
): number {
  if (!Number.isFinite(desiredSizeUsdt) || desiredSizeUsdt <= 0) return 0;
  if (!Number.isFinite(headroom) || headroom <= 0) return 0;
  return Math.min(desiredSizeUsdt, headroom);
}

/**
 * 2026-05-10 — per-agent CUMULATIVE NOTIONAL cap.
 *
 * The existing margin headroom (above) bounds how much capital an
 * agent can commit per Arbiter allocation. It does NOT bound the
 * resulting LEVERAGED exposure: an agent at $20 allocation entering
 * 20× leverage stacks $400 of notional per row. With several rows
 * open, cumulative notional can spiral past 10× account equity
 * even while each individual margin is small.
 *
 * Observed 2026-05-10: Agent L stacked 39 BTC LONG rows on a
 * $200 account → cumulative notional $3500 (17.7× equity), each row
 * within margin limits but the aggregate dominated risk and froze
 * margin for hours. The exchange-side hard cap (Poloniex's per-
 * symbol margin ceiling) catches the worst case but lets the
 * intermediate state — frozen margin, no harvest, drawdown
 * compounding — persist.
 *
 * Cap formula:
 *   maxNotional = allocation × notionalRatio
 * Default notionalRatio = 4.0 (mirrors MONKEY_NOTIONAL_CEILING_RATIO
 * in executive.ts but scoped to per-agent allocation, not total
 * equity). Headroom = max(0, maxNotional − openNotional).
 *
 * Pure function. Caller queries openNotional from DB.
 */
export function computeAgentNotionalHeadroom(
  allocation: number,
  openNotional: number,
  notionalRatio: number = 4.0,
): number {
  if (!Number.isFinite(allocation) || allocation <= 0) return 0;
  if (!Number.isFinite(openNotional) || openNotional < 0) return 0;
  if (!Number.isFinite(notionalRatio) || notionalRatio <= 0) return 0;
  const maxNotional = allocation * notionalRatio;
  return Math.max(0, maxNotional - openNotional);
}

/**
 * Clamp a proposed margin so that margin × leverage stays within
 * the agent's notional headroom. Returns 0 when headroom is exhausted
 * or any input is non-positive.
 */
export function clampMarginToNotionalHeadroom(
  desiredMarginUsdt: number,
  leverage: number,
  notionalHeadroom: number,
): number {
  if (!Number.isFinite(desiredMarginUsdt) || desiredMarginUsdt <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  if (!Number.isFinite(notionalHeadroom) || notionalHeadroom <= 0) return 0;
  const desiredNotional = desiredMarginUsdt * leverage;
  if (desiredNotional <= notionalHeadroom) return desiredMarginUsdt;
  // Notional exceeds headroom — scale margin back so notional == headroom.
  return notionalHeadroom / leverage;
}
