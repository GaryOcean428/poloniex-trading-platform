/**
 * ocean.ts — Tier 7 Ocean: single autonomic intervention authority (TS parity).
 *
 * Mirrors ml-worker/src/monkey_kernel/ocean.py 1:1. Owns the sleep
 * state machine + DREAM/SLEEP/MUSHROOM_MICRO/ESCAPE triggers. Pure
 * decision authority — caller acts on ocean_state.intervention if
 * non-null, otherwise normal flow.
 */

import { fisherRao, type Basin } from './basin.js';

export type SleepPhase = 'AWAKE' | 'SLEEP';
export type Intervention = 'DREAM' | 'SLEEP' | 'WAKE' | 'MUSHROOM_MICRO' | 'ESCAPE';

// Sleep machine constants — preserved from prior SleepCycleManager
const MIN_AWAKE_MS = 2 * 60 * 60 * 1000; // 2 h
const SLEEP_DURATION_MS = 15 * 60 * 1000; // 15 min
const DRIFT_TRIGGER_TICKS = 10; // ~5 min at 30s tick

// SAFETY_BOUND constants (autonomic-health bounds, P14-permitted)
const SPREAD_BOUND = 0.3;
const PHI_DREAM_BOUND = 0.5;
const PHI_ESCAPE_BOUND = 0.15;
const PHI_VARIANCE_BOUND = 0.01;
const PHI_HISTORY_MAX = 60;

export interface SleepCycleState {
  phase: SleepPhase;
  phaseStartedAtMs: number;
  lastSleepEndedAtMs: number;
  sleepCount: number;
  driftStreak: number;
}

export interface OceanState {
  intervention: Intervention | null;
  sleepPhase: SleepPhase;
  /** [0, 1] — basin self-coherence (1 − normalised entropy). */
  coherence: number;
  /** [0, π/2] — max pairwise FR distance across observed lanes. */
  spread: number;
  diagnostics: {
    phiNow: number;
    phiVariance: number;
    driftStreak: number;
    sleepRemainingMs: number;
    laneCount: number;
  };
}

export interface ObserveArgs {
  phi: number;
  basin: Basin;
  currentMode: string;
  isFlat: boolean;
  nowMs?: number;
  crossLaneBasins?: Basin[];
}

const basinCoherence = (basin: Basin): number => {
  const n = basin.length;
  if (n <= 1) return 1.0;
  let h = 0;
  for (let i = 0; i < n; i++) h -= basin[i] * Math.log(basin[i] + 1e-12);
  return 1 - h / Math.log(n);
};

const maxPairwiseFR = (basins: Basin[]): number => {
  if (basins.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < basins.length; i++) {
    for (let j = i + 1; j < basins.length; j++) {
      const d = fisherRao(basins[i], basins[j]);
      if (d > max) max = d;
    }
  }
  return max;
};

const variance = (xs: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
};

export class Ocean {
  readonly sleepState: SleepCycleState;
  private readonly phiHistory: number[] = [];

  constructor(public readonly label: string = 'monkey-primary') {
    this.sleepState = {
      phase: 'AWAKE',
      phaseStartedAtMs: Date.now(),
      lastSleepEndedAtMs: 0,
      sleepCount: 0,
      driftStreak: 0,
    };
  }

  get isAwake(): boolean {
    return this.sleepState.phase === 'AWAKE';
  }

  get phase(): SleepPhase {
    return this.sleepState.phase;
  }

  private stepSleepState(
    currentMode: string,
    isFlat: boolean,
    nowMs: number,
  ): {
    phase: SleepPhase;
    enteredSleep: boolean;
    woke: boolean;
    sleepRemainingMs: number;
  } {
    const prevPhase = this.sleepState.phase;

    if (currentMode === 'drift') this.sleepState.driftStreak += 1;
    else this.sleepState.driftStreak = 0;

    if (this.sleepState.phase === 'AWAKE') {
      const awakeDuration = nowMs - this.sleepState.phaseStartedAtMs;
      const ready =
        awakeDuration > MIN_AWAKE_MS &&
        isFlat &&
        this.sleepState.driftStreak >= DRIFT_TRIGGER_TICKS;
      if (ready) {
        this.sleepState.phase = 'SLEEP';
        this.sleepState.phaseStartedAtMs = nowMs;
      }
    } else {
      const sleepDuration = nowMs - this.sleepState.phaseStartedAtMs;
      if (sleepDuration >= SLEEP_DURATION_MS) {
        this.sleepState.phase = 'AWAKE';
        this.sleepState.phaseStartedAtMs = nowMs;
        this.sleepState.lastSleepEndedAtMs = nowMs;
        this.sleepState.sleepCount += 1;
        this.sleepState.driftStreak = 0;
      }
    }

    const sleepRemainingMs =
      this.sleepState.phase === 'SLEEP'
        ? Math.max(0, SLEEP_DURATION_MS - (nowMs - this.sleepState.phaseStartedAtMs))
        : 0;
    return {
      phase: this.sleepState.phase,
      enteredSleep: prevPhase === 'AWAKE' && this.sleepState.phase === 'SLEEP',
      woke: prevPhase === 'SLEEP' && this.sleepState.phase === 'AWAKE',
      sleepRemainingMs,
    };
  }

  observe(args: ObserveArgs): OceanState {
    const nowMs = args.nowMs ?? Date.now();
    const sleepStep = this.stepSleepState(args.currentMode, args.isFlat, nowMs);

    this.phiHistory.push(args.phi);
    while (this.phiHistory.length > PHI_HISTORY_MAX) this.phiHistory.shift();
    const phiVar = this.phiHistory.length >= 2 ? variance(this.phiHistory) : 0;

    const coherence = basinCoherence(args.basin);
    const lanes = args.crossLaneBasins ?? [];
    const spread = maxPairwiseFR(lanes);

    let intervention: Intervention | null = null;
    if (sleepStep.enteredSleep) {
      intervention = 'SLEEP';
    } else if (sleepStep.woke) {
      intervention = 'WAKE';
    } else if (args.phi < PHI_ESCAPE_BOUND) {
      intervention = 'ESCAPE';
    } else if (spread > SPREAD_BOUND) {
      intervention = 'SLEEP';
    } else if (args.phi < PHI_DREAM_BOUND) {
      intervention = 'DREAM';
    } else if (
      phiVar > 0 &&
      phiVar < PHI_VARIANCE_BOUND &&
      this.phiHistory.length >= 2
    ) {
      intervention = 'MUSHROOM_MICRO';
    }

    return {
      intervention,
      sleepPhase: sleepStep.phase,
      coherence,
      spread,
      diagnostics: {
        phiNow: args.phi,
        phiVariance: phiVar,
        driftStreak: this.sleepState.driftStreak,
        sleepRemainingMs: sleepStep.sleepRemainingMs,
        laneCount: lanes.length,
      },
    };
  }

  snapshot(): Record<string, unknown> {
    return {
      phase: this.sleepState.phase,
      phaseStartedAtMs: this.sleepState.phaseStartedAtMs,
      lastSleepEndedAtMs: this.sleepState.lastSleepEndedAtMs,
      sleepCount: this.sleepState.sleepCount,
      driftStreak: this.sleepState.driftStreak,
      phiHistoryLen: this.phiHistory.length,
    };
  }
}
