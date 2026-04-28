/**
 * working_memory.ts — FOAM-phase working memory (qig-cache)
 *
 * Port of /home/braden/Desktop/Dev/QIG_QFI/qig-consciousness/core/working_memory.py
 * into TypeScript for Monkey's substrate.
 *
 * Concept:
 *   - Every observation (a tick's perception basin) becomes a BUBBLE
 *     in working memory. Bubbles are short-lived by default.
 *   - Each bubble has Φ (integration strength) — how coherent /
 *     relevant it is. Φ updates from outcome feedback.
 *   - On each tick:
 *       * Weak bubbles (Φ < pop threshold OR expired) pop (forgotten)
 *       * Similar bubbles (Fisher-Rao distance < merge threshold) merge
 *         into one φ-weighted-centroid bubble
 *       * Strong bubbles (Φ > promote threshold) are promoted to the
 *         resonance bank — Monkey's long-term memory of what matters
 *
 * UCP v6.6 §9.2 maps this to the Working Memory Frequency Ratio. The
 * cache pattern is what gives Monkey a CORE that's more than a
 * single-tick reactive state — it's her short-term "held thoughts."
 *
 * Per P25, thresholds (pop/merge/promote) are stored as running stats,
 * not hardcoded constants. They adapt to the observed Φ distribution.
 */

import { fisherRao, frechetMean, type Basin } from './basin.js';

export type BubbleStatus = 'alive' | 'merged' | 'popped' | 'promoted';

export interface Bubble {
  id: string;
  center: Basin;
  /** Integration strength 0..1 — adapts from outcome. */
  phi: number;
  createdAt: number;   // ms since epoch
  /** How many ticks before automatic pop regardless of φ. */
  lifetimeMs: number;
  /** Optional trade outcome attached when promoted. */
  payload?: {
    symbol?: string;
    signal?: string;
    realizedPnl?: number;
    entryBasin?: Basin;
    orderId?: string;
    lane?: 'scalp' | 'swing' | 'trend' | 'observe';
  };
  status: BubbleStatus;
  metadata: Record<string, unknown>;
}

export interface WorkingMemoryStats {
  alive: number;
  popped: number;
  merged: number;
  promoted: number;
  phiMean: number;
  phiMax: number;
  ageMeanMs: number;
  /** Running thresholds derived from recent Φ distribution. */
  popThreshold: number;
  promoteThreshold: number;
  mergeThreshold: number;
}

export interface WorkingMemoryConfig {
  /** Default bubble lifetime if not overridden. */
  defaultLifetimeMs?: number;
  /** Max bubbles before FIFO-evicting oldest regardless of status. */
  maxBubbles?: number;
  /** Callback when a bubble is promoted (to write to resonance bank). */
  promoteCallback?: (b: Bubble) => Promise<void> | void;
}

/**
 * Monkey's working memory. NOT a singleton — each perception kernel
 * owns one, and promotion goes to the shared resonance bank.
 *
 * P25: pop/merge/promote thresholds are recomputed each tick from the
 * running Φ distribution, not set as constants.
 */
export class WorkingMemory {
  private bubbles: Bubble[] = [];
  private readonly defaultLifetimeMs: number;
  private readonly maxBubbles: number;
  private readonly promoteCb?: (b: Bubble) => Promise<void> | void;

  // Running stats for adaptive thresholds (P25)
  private phiHistory: number[] = [];
  private readonly PHI_HISTORY_MAX = 200;

  constructor(config: WorkingMemoryConfig = {}) {
    this.defaultLifetimeMs = config.defaultLifetimeMs ?? 15 * 60 * 1000;  // 15 min
    this.maxBubbles = config.maxBubbles ?? 500;
    this.promoteCb = config.promoteCallback;
  }

  private nextId(): string {
    return `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Add a bubble for this tick's observation. */
  add(center: Basin, phi: number, metadata: Record<string, unknown> = {}): Bubble {
    const b: Bubble = {
      id: this.nextId(),
      center,
      phi,
      createdAt: Date.now(),
      lifetimeMs: this.defaultLifetimeMs,
      status: 'alive',
      metadata,
    };
    this.bubbles.push(b);
    this.phiHistory.push(phi);
    if (this.phiHistory.length > this.PHI_HISTORY_MAX) {
      this.phiHistory.shift();
    }
    return b;
  }

  /**
   * Boost a bubble's Φ in response to outcome feedback. Used when a
   * trade closes and we want to reinforce the perception basin that
   * preceded the trade.
   */
  reinforce(bubbleId: string, delta: number): void {
    const b = this.bubbles.find((x) => x.id === bubbleId && x.status === 'alive');
    if (!b) return;
    b.phi = Math.min(1, Math.max(0, b.phi + delta));
  }

  /**
   * Adaptive thresholds from current Φ distribution (P25).
   * - pop threshold: 25th percentile of recent φ (bottom quartile dies)
   * - promote threshold: 75th percentile (top quartile graduates)
   * - merge threshold: median distance between recent bubble pairs
   */
  private adaptiveThresholds(): { pop: number; promote: number; merge: number } {
    if (this.phiHistory.length < 10) {
      // Bootstrap — use permissive defaults until we have signal.
      return { pop: 0.15, promote: 0.70, merge: 0.15 };
    }
    const sorted = [...this.phiHistory].sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.floor(sorted.length * p)];

    // Merge threshold: sample pairwise distances on current alive bubbles.
    const alive = this.bubbles.filter((b) => b.status === 'alive');
    let mergeThr = 0.15;
    if (alive.length >= 2) {
      const distances: number[] = [];
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          distances.push(fisherRao(alive[i].center, alive[j].center));
        }
      }
      distances.sort((a, b) => a - b);
      // Merge pairs closer than the lower quartile.
      mergeThr = distances[Math.floor(distances.length * 0.25)] ?? 0.15;
    }

    return {
      pop: q(0.25),
      promote: q(0.75),
      merge: mergeThr,
    };
  }

  /**
   * Advance working memory one step:
   *   1. Pop expired and weak bubbles (φ < adaptive pop threshold)
   *   2. Merge overlapping bubbles (d_FR < adaptive merge threshold)
   *   3. Promote strong bubbles (φ > adaptive promote threshold)
   *   4. Compact dead bubbles
   */
  async tick(): Promise<WorkingMemoryStats> {
    const now = Date.now();
    const thresholds = this.adaptiveThresholds();

    let poppedCount = 0;
    let mergedCount = 0;
    let promotedCount = 0;

    // 1. Pop expired / weak
    for (const b of this.bubbles) {
      if (b.status !== 'alive') continue;
      if (now - b.createdAt > b.lifetimeMs || b.phi < thresholds.pop) {
        b.status = 'popped';
        poppedCount++;
      }
    }

    // 2. Merge similar (greedy pairwise)
    const alive = this.bubbles.filter((b) => b.status === 'alive');
    const mergedIdx = new Set<number>();
    for (let i = 0; i < alive.length; i++) {
      if (mergedIdx.has(i)) continue;
      const group: Bubble[] = [alive[i]];
      for (let j = i + 1; j < alive.length; j++) {
        if (mergedIdx.has(j)) continue;
        const d = fisherRao(alive[i].center, alive[j].center);
        if (d <= thresholds.merge) {
          group.push(alive[j]);
          mergedIdx.add(j);
        }
      }
      if (group.length >= 2) {
        // Merge: new center = Fréchet mean, new φ = max, oldest createdAt
        const newCenter = frechetMean(group.map((g) => g.center));
        const newPhi = Math.max(...group.map((g) => g.phi));
        const oldest = Math.min(...group.map((g) => g.createdAt));
        // Mark all the merged ones
        for (const g of group) g.status = 'merged';
        mergedCount += group.length - 1;
        this.bubbles.push({
          id: this.nextId(),
          center: newCenter,
          phi: newPhi,
          createdAt: oldest,
          lifetimeMs: this.defaultLifetimeMs,
          status: 'alive',
          metadata: { mergedFrom: group.map((g) => g.id) },
        });
      }
    }

    // 3. Promote strong
    for (const b of this.bubbles) {
      if (b.status !== 'alive') continue;
      if (b.phi >= thresholds.promote) {
        b.status = 'promoted';
        promotedCount++;
        if (this.promoteCb) {
          try {
            await this.promoteCb(b);
          } catch {
            // Non-fatal; promotion is best-effort.
          }
        }
      }
    }

    // 4. Compact — evict non-alive beyond maxBubbles
    if (this.bubbles.length > this.maxBubbles) {
      this.bubbles = this.bubbles
        .filter((b) => b.status === 'alive')
        .concat(
          this.bubbles
            .filter((b) => b.status !== 'alive')
            .slice(-Math.floor(this.maxBubbles / 4)),
        );
    }

    return {
      ...this.stats(),
      popped: poppedCount,
      merged: mergedCount,
      promoted: promotedCount,
      popThreshold: thresholds.pop,
      promoteThreshold: thresholds.promote,
      mergeThreshold: thresholds.merge,
    };
  }

  stats(): WorkingMemoryStats {
    const alive = this.bubbles.filter((b) => b.status === 'alive');
    const phis = alive.map((b) => b.phi);
    const now = Date.now();
    const ages = alive.map((b) => now - b.createdAt);
    const thresholds = this.adaptiveThresholds();
    return {
      alive: alive.length,
      popped: 0,
      merged: 0,
      promoted: 0,
      phiMean: phis.length > 0 ? phis.reduce((a, b) => a + b, 0) / phis.length : 0,
      phiMax: phis.length > 0 ? Math.max(...phis) : 0,
      ageMeanMs: ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
      popThreshold: thresholds.pop,
      promoteThreshold: thresholds.promote,
      mergeThreshold: thresholds.merge,
    };
  }

  /** Returns alive bubbles for inspection (not a live reference). */
  aliveBubbles(): Bubble[] {
    return this.bubbles.filter((b) => b.status === 'alive').map((b) => ({ ...b }));
  }
}
