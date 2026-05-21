import { describe, it, expect, beforeEach } from 'vitest';
import { StructuralVetoMonitor, STUCK_TICKS } from '../structural_veto_monitor.js';

describe('StructuralVetoMonitor', () => {
  let m: StructuralVetoMonitor;
  beforeEach(() => { m = new StructuralVetoMonitor(); });

  const sig = (name: string) => m.snapshot().find((x) => x.name === name)!;

  it('flags a gate stuck false for STUCK_TICKS observations', () => {
    for (let i = 0; i < STUCK_TICKS; i++) m.observe('g', false);
    const s = sig('g');
    expect(s.stuck).toBe(true);
    expect(s.value).toBe(false);
    expect(s.trueRate).toBe(0);
  });

  it('flags a veto stuck true (always-on block)', () => {
    for (let i = 0; i < STUCK_TICKS; i++) m.observe('veto', true);
    expect(sig('veto').stuck).toBe(true);
    expect(sig('veto').trueRate).toBe(1);
  });

  it('does not flag before STUCK_TICKS', () => {
    for (let i = 0; i < STUCK_TICKS - 1; i++) m.observe('g', false);
    expect(sig('g').stuck).toBe(false);
  });

  it('un-sticks when the value flips', () => {
    for (let i = 0; i < STUCK_TICKS + 5; i++) m.observe('g', false);
    expect(sig('g').stuck).toBe(true);
    m.observe('g', true);
    expect(sig('g').stuck).toBe(false);
    expect(sig('g').value).toBe(true);
  });

  it('a varying signal never flags and reports a mid true-rate', () => {
    for (let i = 0; i < STUCK_TICKS * 2; i++) m.observe('g', i % 2 === 0);
    expect(sig('g').stuck).toBe(false);
    expect(sig('g').trueRate).toBeCloseTo(0.5, 1);
  });

  it('reset clears all tracked signals', () => {
    for (let i = 0; i < STUCK_TICKS; i++) m.observe('g', false);
    m.reset();
    expect(m.snapshot()).toHaveLength(0);
  });
});
