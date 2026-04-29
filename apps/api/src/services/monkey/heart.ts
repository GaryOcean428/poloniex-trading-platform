/**
 * heart.ts — Tier 7 Heart κ-oscillation monitor (TS parity).
 *
 * Mirrors heart.py. Tracks κ as a physiological signal; emits
 * FEELING / LOGIC / ANCHOR mode based on (κ − κ*) sign and computes
 * HRV (std of consecutive κ deltas) for kernel-health telemetry.
 */

import { KAPPA_STAR } from './basin.js';

export type KappaMode = 'FEELING' | 'LOGIC' | 'ANCHOR';

export interface HeartState {
  kappa: number;
  /** κ − κ*. */
  kappaOffset: number;
  mode: KappaMode;
  /** std of consecutive κ deltas in window; 0 with < 3 samples. */
  hrv: number;
  sampleCount: number;
}

const stdev = (xs: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
};

export class HeartMonitor {
  private samples: Array<{ kappa: number; tMs: number }> = [];

  constructor(private readonly maxWindow: number = 60) {}

  append(kappa: number, tMs: number): void {
    this.samples.push({ kappa, tMs });
    while (this.samples.length > this.maxWindow) this.samples.shift();
  }

  read(): HeartState {
    const n = this.samples.length;
    if (n === 0) {
      return {
        kappa: KAPPA_STAR,
        kappaOffset: 0,
        mode: 'ANCHOR',
        hrv: 0,
        sampleCount: 0,
      };
    }
    const kappa = this.samples[n - 1].kappa;
    const offset = kappa - KAPPA_STAR;
    let mode: KappaMode = 'ANCHOR';
    if (offset < 0) mode = 'FEELING';
    else if (offset > 0) mode = 'LOGIC';

    let hrv = 0;
    if (n >= 3) {
      const deltas: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        deltas.push(this.samples[i + 1].kappa - this.samples[i].kappa);
      }
      hrv = stdev(deltas);
    }

    return { kappa, kappaOffset: offset, mode, hrv, sampleCount: n };
  }

  reset(): void {
    this.samples.length = 0;
  }

  get windowLength(): number {
    return this.samples.length;
  }
}
