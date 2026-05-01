/**
 * turtle_agent/index.ts — Agent T (Turtle System 1) public surface.
 *
 * Re-exports for the loop integration. Internal helpers live in
 * the dedicated modules.
 */

export {
  trueRange,
  atrSeries,
  latestAtr,
} from './atr.js';
export {
  donchianHigh,
  donchianLow,
  latestDonchianHigh,
  latestDonchianLow,
} from './donchian.js';
export {
  newTurtleState,
  turtleHeldSide,
  lastUnitEntry,
  type TurtleAccount,
  type TurtleOHLCV,
  type TurtleState,
  type TurtleUnit,
} from './state.js';
export {
  turtleAgentDecide,
  appendUnit,
  clearUnitsAfterExit,
  turtleMinEquityUsdt,
  TURTLE_ENTRY_PERIOD,
  TURTLE_EXIT_PERIOD,
  TURTLE_ATR_PERIOD,
  TURTLE_STOP_ATR_MULT,
  TURTLE_PYRAMID_STEP_ATR_MULT,
  TURTLE_MAX_UNITS,
  TURTLE_UNIT_RISK_FRACTION,
  TURTLE_DEFAULT_LEVERAGE,
  TURTLE_MIN_EQUITY_USDT_DEFAULT,
  type TurtleAction,
  type TurtleAgentInputs,
  type TurtleAgentDecision,
} from './decide.js';
