/**
 * turtle_agent/state.ts — Agent T (Turtle System 1) types + state.
 *
 * Agent T is the classical-TA control arm in the K / M / T
 * three-agent decomposition. It is INTENTIONALLY non-QIG-pure: that
 * is the point. K runs on Fisher-Rao basin geometry, M runs on ML
 * threshold logic, T runs on Donchian / ATR — three independent
 * epistemologies, no information flow between them, raced on the
 * same live account by the arbiter.
 *
 * The hard rule is *no inter-agent state reads*: T's ``decide()``
 * function takes only (symbol, ohlcv, account, allocation). It does
 * NOT take K's basin / regime / emotions, M's mlSignal / mlStrength,
 * or the arbiter's view of K or M's PnL — only its own state.
 */

/** OHLCV row. Same shape as the kernel + ml_agent inputs but kept
 *  local so T doesn't import from either of those modules (the wall
 *  is in the type graph as well as the runtime control flow). */
export interface TurtleOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Account snapshot at the current tick. T sees only the account
 *  fields it needs — equity for the activation gate, available
 *  capital for sizing, and its OWN held units (not K's, not M's). */
export interface TurtleAccount {
  /** Total account equity in USDT (mark-to-market). The activation
   *  gate trips on this. */
  equityUsdt: number;
  /** Capital available for fresh entries this tick (after open
   *  margin reserved by other agents). */
  availableEquityUsdt: number;
}

/** A single Turtle "unit" — one lot of position the agent is long /
 *  short. Pyramiding adds further units as the trade moves
 *  favorably; each unit has its own entry price + stop. The agent
 *  closes them as a group on the 10-bar opposite Donchian extreme
 *  or the 2× ATR stop. */
export interface TurtleUnit {
  /** Direction of the unit. */
  side: 'long' | 'short';
  /** Fill price of this unit. */
  entryPrice: number;
  /** ATR(20) reading at the moment this unit was added. The 2× ATR
   *  stop and the 0.5× ATR pyramid step are both anchored to the
   *  ATR observed when the unit was OPENED — not the current ATR.
   *  This is the Turtle convention; it stops the stop from drifting
   *  as ATR fluctuates around the trend. */
  atrAtEntry: number;
  /** Initial stop price (entry - 2*ATR for long, entry + 2*ATR for
   *  short). Stays static for this unit; next unit's stop is its
   *  own entry ± 2× ATR. */
  stopPrice: number;
  /** Margin USDT committed to this unit (after leverage). */
  marginUsdt: number;
  /** Leverage used to open this unit. */
  leverage: number;
  /** ms timestamp the unit was opened. */
  openedAtMs: number;
  /** 0-indexed unit number within the current pyramid (first = 0,
   *  fourth = 3). Caps at 3 (4 units total = Turtle classic max). */
  unitIndex: number;
}

/** Per-symbol state Agent T carries between ticks. Reset when the
 *  pyramid is fully closed (last unit exited). */
export interface TurtleState {
  /** Held units, in entry order. Empty when flat. */
  units: TurtleUnit[];
  /** ms timestamp of the most recent exit (any reason). Used for
   *  diagnostics and for downstream filters that may want to wait
   *  N bars after a stop-out before re-entering. */
  lastExitAtMs: number | null;
  /** Reason text from the most recent exit. Diagnostic only. */
  lastExitReason: string | null;
}

/** Construct a fresh empty state. */
export function newTurtleState(): TurtleState {
  return { units: [], lastExitAtMs: null, lastExitReason: null };
}

/** Read the side T is currently holding, or null when flat. */
export function turtleHeldSide(state: TurtleState): 'long' | 'short' | null {
  return state.units[0]?.side ?? null;
}

/** Read the entry price of the most recently added unit, or null
 *  when flat. Pyramiding compares the current price against this
 *  price + 0.5 × ATR. */
export function lastUnitEntry(state: TurtleState): TurtleUnit | null {
  return state.units[state.units.length - 1] ?? null;
}
