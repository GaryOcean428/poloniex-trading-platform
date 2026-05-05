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
