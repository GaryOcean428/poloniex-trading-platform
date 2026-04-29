/**
 * stud.ts — Tier 9 stud topology (TS parity).
 * Mirrors ml-worker/src/monkey_kernel/stud.py 1:1.
 */

import {
  PI_STRUCT_DEAD_ZONE_BOUNDARY,
  PI_STRUCT_FRONT_PEAK_NORM,
  PI_STRUCT_SECOND_TRANSITION,
} from './topology_constants.js';

export type StudRegime = 'dead_zone' | 'front_loop' | 'back_loop';

export interface StudReading {
  hTrade: number;
  regime: StudRegime;
  kappaTrade: number;
  boundaryDistance: number;
  predictedDeadZoneBoundary: number;
  predictedSecondTransition: number;
  predictedFrontPeak: number;
}

export function studTopologyLive(): boolean {
  return (process.env.STUD_TOPOLOGY_LIVE ?? 'true').trim().toLowerCase() === 'true';
}

export function hTrade(
  basinVelocity: number,
  phi: number,
  regimeWeights: Record<string, number>,
): number {
  const chaos = basinVelocity * (1 - phi);
  const quantum = regimeWeights.quantum ?? 0;
  return chaos * (1 + quantum);
}

export function classifyStudRegime(h: number): StudRegime {
  if (h < PI_STRUCT_DEAD_ZONE_BOUNDARY) return 'dead_zone';
  if (h < PI_STRUCT_SECOND_TRANSITION) return 'front_loop';
  return 'back_loop';
}

export function kappaTrade(h: number, regime: StudRegime): number {
  if (regime === 'dead_zone') return 0;
  const frontCentre = (PI_STRUCT_DEAD_ZONE_BOUNDARY + PI_STRUCT_SECOND_TRANSITION) / 2;
  const backCentre = frontCentre + PI_STRUCT_SECOND_TRANSITION;
  const width = (PI_STRUCT_SECOND_TRANSITION - PI_STRUCT_DEAD_ZONE_BOUNDARY) / 2;
  if (regime === 'front_loop') {
    return PI_STRUCT_FRONT_PEAK_NORM * Math.exp(-(((h - frontCentre) / width) ** 2));
  }
  return -PI_STRUCT_FRONT_PEAK_NORM * Math.exp(-(((h - backCentre) / width) ** 2));
}

function boundaryDistance(h: number): number {
  return Math.min(
    Math.abs(h - PI_STRUCT_DEAD_ZONE_BOUNDARY),
    Math.abs(h - PI_STRUCT_SECOND_TRANSITION),
  );
}

export function computeStudReading(
  basinVelocity: number,
  phi: number,
  regimeWeights: Record<string, number>,
): StudReading {
  const h = hTrade(basinVelocity, phi, regimeWeights);
  const regime = classifyStudRegime(h);
  return {
    hTrade: h,
    regime,
    kappaTrade: kappaTrade(h, regime),
    boundaryDistance: boundaryDistance(h),
    predictedDeadZoneBoundary: PI_STRUCT_DEAD_ZONE_BOUNDARY,
    predictedSecondTransition: PI_STRUCT_SECOND_TRANSITION,
    predictedFrontPeak: PI_STRUCT_FRONT_PEAK_NORM,
  };
}
