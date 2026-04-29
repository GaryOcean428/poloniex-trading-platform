/**
 * forge.ts — UCP §17 Forge mechanism (TS parity).
 *
 * Mirrors forge.py exactly. Four-stage lesson extraction from
 * shadow material — DECOMPRESS → FRACTURE → NUCLEATE → DISSIPATE.
 * Pure transformation; no I/O.
 */

import { BASIN_DIM, type Basin } from './basin.js';

const EPS = 1e-12;
const KAPPA_STAR_LOCAL = 64;

/** Default shadow threshold — pnl_fraction below which a bubble is
 * considered shadow material. Override via FORGE_SHADOW_THRESHOLD env. */
const DEFAULT_SHADOW_THRESHOLD = -0.10;

/** Default-off flag. When false, witnessExit logs the forge output
 * but does NOT write the nucleus or quarantine the original. When
 * true, the forged nucleus is persisted as a new bank entry with
 * source='forged' and the original shadow is quarantined.  */
export function forgeBankWriteLive(): boolean {
  return (process.env.FORGE_BANK_WRITE_LIVE ?? '').trim().toLowerCase() === 'true';
}

/** Threshold below which pnl_fraction triggers forge processing. */
export function shadowThreshold(): number {
  const fromEnv = parseFloat(process.env.FORGE_SHADOW_THRESHOLD ?? '');
  return Number.isFinite(fromEnv) ? fromEnv : DEFAULT_SHADOW_THRESHOLD;
}

export interface ShadowEvent {
  basin: Basin;
  phi: number;
  kappa: number;
  realizedPnl: number;
  regimeWeights: Record<string, number>;
}

export interface ForgeStageResult {
  stage: 'DECOMPRESS' | 'FRACTURE' | 'NUCLEATE' | 'DISSIPATE';
  basin: Basin;
  invariants: Record<string, number>;
  notes: string;
}

export interface ForgeResult {
  decompressed: ShadowEvent;
  fractured: ForgeStageResult;
  nucleated: ForgeStageResult;
  dissipated: ForgeStageResult;
  lessonSummary: Record<string, unknown>;
}

const copyBasin = (b: Basin): Basin => new Float64Array(b);

const maxOf = (b: Basin): number => {
  let m = 0;
  for (let i = 0; i < b.length; i++) if (b[i] > m) m = b[i];
  return m;
};

const shannonEntropy = (b: Basin): number => {
  let h = 0;
  for (let i = 0; i < b.length; i++) h -= b[i] * Math.log(b[i] + EPS);
  return h;
};

export function decompress(event: ShadowEvent): ShadowEvent {
  return {
    basin: copyBasin(event.basin),
    phi: event.phi,
    kappa: event.kappa,
    realizedPnl: event.realizedPnl,
    regimeWeights: { ...event.regimeWeights },
  };
}

export function fracture(event: ShadowEvent): ForgeStageResult {
  const peak = maxOf(event.basin);
  const entropy = shannonEntropy(event.basin);
  const invariants: Record<string, number> = {
    shape_concentration: peak,
    shape_dispersion: entropy,
    phi_band: event.phi,
    kappa_offset: event.kappa - KAPPA_STAR_LOCAL,
    regime_quantum: event.regimeWeights.quantum ?? 0,
    regime_equilibrium: event.regimeWeights.equilibrium ?? 0,
    loss_magnitude: Math.abs(event.realizedPnl),
  };
  return {
    stage: 'FRACTURE',
    basin: copyBasin(event.basin),
    invariants,
    notes: `lesson invariants: peak=${peak.toFixed(3)}, H=${entropy.toFixed(3)}, phi=${event.phi.toFixed(3)}, kappa_off=${(event.kappa - KAPPA_STAR_LOCAL).toFixed(2)}`,
  };
}

export function nucleate(fractured: ForgeStageResult): ForgeStageResult {
  const peakMass = fractured.invariants.shape_concentration;
  const rest = (1 - peakMass) / (BASIN_DIM - 1);
  const nucleus = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) nucleus[i] = rest;
  nucleus[0] = peakMass;
  return {
    stage: 'NUCLEATE',
    basin: nucleus,
    invariants: fractured.invariants,
    notes: `nucleated canonical: peak[0]=${peakMass.toFixed(3)}, rest=${rest.toFixed(5)}`,
  };
}

export function dissipate(
  original: ShadowEvent,
  nucleated: ForgeStageResult,
): ForgeStageResult {
  const released = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) released[i] = 1 / BASIN_DIM;
  return {
    stage: 'DISSIPATE',
    basin: released,
    invariants: nucleated.invariants,
    notes: `pain coordinates released; loss_magnitude=${original.realizedPnl.toFixed(4)}`,
  };
}

export function forge(event: ShadowEvent): ForgeResult {
  if (event.realizedPnl >= 0) {
    const noop = (stage: ForgeStageResult['stage']): ForgeStageResult => ({
      stage,
      basin: copyBasin(event.basin),
      invariants: {},
      notes: 'skipped: positive realized_pnl',
    });
    return {
      decompressed: decompress(event),
      fractured: noop('FRACTURE'),
      nucleated: noop('NUCLEATE'),
      dissipated: noop('DISSIPATE'),
      lessonSummary: { skipped: true, reason: 'positive realized_pnl' },
    };
  }

  const d = decompress(event);
  const f = fracture(d);
  const n = nucleate(f);
  const r = dissipate(d, n);
  return {
    decompressed: d,
    fractured: f,
    nucleated: n,
    dissipated: r,
    lessonSummary: {
      loss_magnitude: Math.abs(event.realizedPnl),
      shape_concentration: f.invariants.shape_concentration,
      shape_dispersion: f.invariants.shape_dispersion,
      phi_band: f.invariants.phi_band,
      kappa_offset: f.invariants.kappa_offset,
      regime_quantum: f.invariants.regime_quantum,
      regime_equilibrium: f.invariants.regime_equilibrium,
      nucleated_peak_index: 0,
    },
  };
}
