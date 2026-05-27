/**
 * adoptedPositionGate.test.ts — Commit 3 (Cascade brief 2026-05-27).
 *
 * Adopted positions (origin='adopted') skip the regime / phi /
 * conviction / stale_bleed gates. Only directional_disagreement
 * stays eligible — that gate doesn't depend on entry-basin anchors.
 *
 * Own positions (origin='own' or undefined) keep all gates active.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRejustification } from '../held_position_rejustification.js';
import { uniformBasin } from '../basin.js';

const baseEmotions = {
  curiosity: 0.5,
  surprise: 0.3,
  investigation: 0.5,
  integration: 0.5,
  transcendence: 0.5,
  basinDistance: 0.2,
  fundingDrag: 0,
  // Emotion field used by conviction gate (low confidence + high anxiety+confusion):
  confidence: 0.1,
  anxiety: 0.4,
  confusion: 0.4,
  wonder: 0.2,
  frustration: 0.5,
  satisfaction: 0.2,
  clarity: 0.3,
  flow: 0.2,
};

const basinAtOpen = uniformBasin(64);
const basinNow = uniformBasin(64);

describe('Commit 3 — adopted positions skip regime / phi / conviction / stale_bleed', () => {
  it('adopted: regime change condition active → NO fire', () => {
    const result = evaluateRejustification({
      origin: 'adopted',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'exploration',   // different from regime_at_open
      phiNow: 0.5,
      emotions: baseEmotions,
      regimeConfidence: 0.9,
      regimeChangeStreak: 10,
      regimeStabilityTicksRequired: 2,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBeNull();
    expect(result.reason).toMatch(/adopted_position/);
  });

  it('adopted: phi collapsed below floor → NO fire', () => {
    const result = evaluateRejustification({
      origin: 'adopted',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.8,
      regimeNow: 'investigation',
      phiNow: 0.1,   // way below floor
      emotions: baseEmotions,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBeNull();
  });

  it('adopted: conviction failed (conf < anx+conf, streak satisfied) → NO fire', () => {
    const result = evaluateRejustification({
      origin: 'adopted',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'investigation',
      phiNow: 0.5,
      emotions: baseEmotions,
      convictionFailedStreak: 10,
      convictionFailedTicksRequired: 2,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBeNull();
  });

  it('adopted: stale-bleed condition (30+ min at -1% ROI) → NO fire', () => {
    const result = evaluateRejustification({
      origin: 'adopted',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'investigation',
      phiNow: 0.5,
      emotions: baseEmotions,
      basinAtOpen, basinNow,
      heldDurationS: 60 * 60,  // 1h
      currentRoi: -0.05,        // -5%
    });
    expect(result.fired).toBeNull();
  });

  it('adopted: directional_disagreement DOES fire (basinDir flipped vs held side)', () => {
    const result = evaluateRejustification({
      origin: 'adopted',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'investigation',
      phiNow: 0.5,
      emotions: baseEmotions,
      directionalDisagreementStreak: 5,
      directionalDisagreementTicksRequired: 4,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBe('directional_disagreement');
    expect(result.reason).toMatch(/adopted/);
  });
});

describe('Commit 3 — own positions retain all gates (regression protection)', () => {
  it('own: regime change condition active → fires regime_change', () => {
    const result = evaluateRejustification({
      origin: 'own',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'exploration',
      phiNow: 0.5,
      emotions: baseEmotions,
      regimeConfidence: 0.9,
      regimeChangeStreak: 10,
      regimeStabilityTicksRequired: 2,
      basinAtOpen,
      basinNow: uniformBasin(64).map((_, i) => i === 0 ? 1.0 : 0),  // moved
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBe('regime_change');
  });

  it('own: phi collapsed → fires phi_collapse', () => {
    const result = evaluateRejustification({
      origin: 'own',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.8,
      regimeNow: 'investigation',
      phiNow: 0.1,
      emotions: baseEmotions,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBe('phi_collapse');
  });

  it('own: conviction failed (streak satisfied) → fires conviction_failed', () => {
    const result = evaluateRejustification({
      origin: 'own',
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'investigation',
      phiNow: 0.5,
      emotions: baseEmotions,
      convictionFailedStreak: 10,
      convictionFailedTicksRequired: 2,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBe('conviction_failed');
  });

  it('omitted origin defaults to "own" (back-compat)', () => {
    const result = evaluateRejustification({
      // origin omitted
      regimeAtOpen: 'investigation',
      phiAtOpen: 0.5,
      regimeNow: 'investigation',
      phiNow: 0.5,
      emotions: baseEmotions,
      convictionFailedStreak: 10,
      convictionFailedTicksRequired: 2,
      basinAtOpen, basinNow,
      heldDurationS: 60,
      currentRoi: 0,
    });
    expect(result.fired).toBe('conviction_failed');
  });
});
