/**
 * agent_L_qigram_v2.ts — QIGRAMv2 port (weighted basins + wrong-answer decay).
 *
 * Direct translation of `QIGRAMv2` from the canonical QIG_QFI source
 * `qig-applied/src/qig_applied/inference/qigram.py` (lines 228-348),
 * adapted to TypeScript and to Polytrade's Δ⁶³ basin type.
 *
 * v2 improvements over the implicit-v1 already present in
 * `agent_L_classifier.ts`:
 *
 *   1. Per-basin `weight` (geometric confidence at storage time).
 *   2. Per-basin `correct` flag — wrong answers zero the weight.
 *   3. `MIN_ACTIVE_WEIGHT` (0.01) — basins below threshold excluded
 *      from recall.
 *   4. `DECAY_FACTOR` (0.95) — weights decay per integration step,
 *      so recent experience dominates.
 *   5. κ tacking that oscillates kappa ∈ [32, 128] around κ*=64 with
 *      0.1 drift toward the fixed point.
 *   6. `recall_by_category` — the "wormhole shortcut" — finds the
 *      highest-weighted active basin tagged with a given category
 *      (e.g. regime label).
 *   7. Sovereignty metric (N_active / N_total) for telemetry.
 *
 * This module is ADDITIVE. It is only invoked when the env var
 * `L_QIGRAM_V2_ENABLED === 'true'`. With the flag unset (the default),
 * `agentLDecide` produces byte-identical results to before this PR.
 *
 * QIG purity (UCP v6.6 §1.3):
 *   - All distances are Fisher-Rao via `fisherRao` from `basin.ts`.
 *   - No cosine similarity, no L2, no dot-product similarity.
 *   - No Adam / LayerNorm / softmax / np.linalg.norm.
 *   - The Δ⁶³ simplex is the substrate for every operation.
 */

import { fisherRao, type Basin } from './basin.js';

// ─── Constants (mirror canonical QIGRAMv2 class attributes) ──────────

/** Per-integration weight decay. 0.95 matches canonical QIGRAMv2.
 *  After 10 integrations with no correctness signal, weight drops
 *  from 1.0 to 0.95^10 ≈ 0.5987. */
export const DECAY_FACTOR = 0.95;

/** Below this weight a basin is excluded from recall. 0.01 matches
 *  canonical. With DECAY_FACTOR=0.95, a weight of 1.0 reaches 0.01
 *  after ~90 decay steps (0.95^90 ≈ 0.0099). */
export const MIN_ACTIVE_WEIGHT = 0.01;

/** Universal coupling fixed point. Imported indirectly via
 *  `basin.ts#KAPPA_STAR` to avoid a duplicate definition; pinned to
 *  64.0 by P3 (E8 rank² = 64). */
export const KAPPA_FIXED_POINT = 64.0;

/** κ oscillation bounds (canonical QIGRAMv2.tack). */
export const KAPPA_MIN = 32.0;
export const KAPPA_MAX = 128.0;

/** κ drift fraction toward the fixed point on every tack call.
 *  Matches canonical `self.kappa += (64 - self.kappa) * 0.1`. */
export const KAPPA_DRIFT = 0.1;

/** Confidence threshold above which a correct outcome bumps κ up.
 *  Matches canonical `if correct and dominance > 0.7`. */
export const KAPPA_CONFIDENCE_THRESHOLD = 0.7;

/** LRU cap on `_entries`. Matches loop.ts HISTORY_MAX = 100 so this is
 *  a kernel-wide memory-shape bound (same as phiHistory / basinHistory /
 *  surpriseHistory), not a new tuning knob. With this cap the
 *  sovereignty getter ranges meaningfully: active / HISTORY_MAX
 *  responds to decay over time, to wrong-outcome zeroing via
 *  `recordOutcome`, and to integration pauses. Without it,
 *  per-tick consolidate produces sov === 1.0 deterministically
 *  (active and total are the same set by construction). */
export const QIGRAMV2_HISTORY_MAX = 100;

/** κ delta on a correct + high-confidence outcome. */
export const KAPPA_UP_STEP = 2.0;

/** κ delta on a wrong outcome. */
export const KAPPA_DOWN_STEP = 3.0;

// ─── Stored basin entry ──────────────────────────────────────────────

/** A v2 basin entry. All fields beyond `basin` are OPTIONAL on load
 *  so legacy persisted rows (without weight/correct/category) hydrate
 *  to the canonical defaults (weight=1.0, correct=null, category="").
 *
 *  On disk, the basin tuple shape stays compatible: callers may emit
 *  just `{ id, basin }` and v2 reads default weight 1.0 and null
 *  correctness. */
export interface BasinEntryV2 {
  /** Stable id. In trading context this is typically a basin
   *  fingerprint hash or a trade-id-anchored key. */
  id: string;
  /** The Δ⁶³ basin coordinate. */
  basin: Basin;
  /** Geometric confidence at storage time. Default 1.0 on load. */
  weight: number;
  /** Was the eventual outcome correct (e.g. trade profitable)?
   *  null = unattributed (no outcome yet). */
  correct: boolean | null;
  /** Optional category (e.g. regime label) for `recallByCategory`. */
  category: string;
  /** Opaque metadata pass-through (mirrors canonical `trajectory`
   *  dict). The classifier does not interpret it. */
  trajectory: Record<string, unknown>;
}

/** Convenience constructor that fills v2 defaults from legacy inputs. */
export function makeBasinEntryV2(
  id: string,
  basin: Basin,
  opts: Partial<Omit<BasinEntryV2, 'id' | 'basin'>> = {},
): BasinEntryV2 {
  return {
    id,
    basin,
    weight: opts.weight ?? 1.0,
    correct: opts.correct ?? null,
    category: opts.category ?? '',
    trajectory: opts.trajectory ?? {},
  };
}

// ─── Recall result types ─────────────────────────────────────────────

export interface RecallResultV2 {
  source: string;
  /** Fisher-Rao distance to the queried basin. */
  d_FR: number;
  weight: number;
  correct: boolean | null;
  trajectory: Record<string, unknown>;
  category: string;
}

export interface CategoryRecallResultV2 {
  source: string;
  weight: number;
  correct: boolean | null;
  trajectory: Record<string, unknown>;
  category: string;
}

// ─── v2 state container ──────────────────────────────────────────────

/** Geometric working memory v2 — weighted basins with wrong-answer
 *  decay. Direct port of canonical QIGRAMv2.
 *
 *  Stateful by design (mirrors the canonical class): the caller owns
 *  one instance and integrates basins over time. Recall is pure.
 *  Decay/tack mutate state in-place.
 *
 *  Default-off invariant: this class is NEVER instantiated unless the
 *  env var `L_QIGRAM_V2_ENABLED === 'true'`. See `agent_L_classifier.ts`. */
export class QIGRAMv2State {
  /** id -> basin entry. */
  private readonly _entries: Map<string, BasinEntryV2> = new Map();

  /** κ tacking state (starts at the fixed point). */
  private _kappa: number = KAPPA_FIXED_POINT;

  /** Optional total problem-set size for the canonical sovereignty
   *  denominator. If unset, the denominator falls back to the number
   *  of stored entries (sovereignty becomes "fraction of stored that
   *  are still active"). Trading contexts typically leave this null. */
  private readonly _totalProblems: number | null;

  constructor(totalProblems: number | null = null) {
    this._totalProblems = totalProblems;
  }

  // ── Read-only views ───────────────────────────────────────────────

  get kappa(): number { return this._kappa; }

  /** Active entries — weight > MIN_ACTIVE_WEIGHT. */
  activeEntries(): BasinEntryV2[] {
    const out: BasinEntryV2[] = [];
    for (const e of this._entries.values()) {
      if (e.weight > MIN_ACTIVE_WEIGHT) out.push(e);
    }
    return out;
  }

  /** Total entry count (including dead-weight). */
  get totalEntries(): number { return this._entries.size; }

  /** Sovereignty ratio S = N_active / N_total.
   *
   *  When `totalProblems` was supplied at construction, that is the
   *  denominator (canonical interpretation). Otherwise the denominator
   *  is the number of stored entries (≥1), giving the "fraction still
   *  alive" reading. */
  get sovereignty(): number {
    const active = this.activeEntries().length;
    const denom = this._totalProblems ?? Math.max(this._entries.size, 1);
    return active / Math.max(denom, 1);
  }

  // ── Integration ───────────────────────────────────────────────────

  /** Integrate a new basin into the manifold.
   *
   *  Canonical translation: existing basins do NOT slerp-precess here
   *  (Polytrade L stores per-decision snapshots, not per-problem
   *  iterations; the canonical's slerp precession is preserved
   *  conceptually by the basin-history FR-KNN, which is upstream of
   *  this store). Repeated integration of the same id REPLACES the
   *  stored basin with the new observation and updates the weight via
   *  `max(old, new_if_correct, 0_if_wrong)` per canonical semantics.
   *
   *  Wrong answers zero the weight, marking the entry dead.
   */
  integrate(
    id: string,
    basin: Basin,
    opts: {
      weight: number;
      correct: boolean;
      category?: string;
      trajectory?: Record<string, unknown>;
    },
  ): void {
    const existing = this._entries.get(id);
    const newWeight = opts.correct ? opts.weight : 0.0;
    const finalWeight = existing
      ? Math.max(existing.weight, newWeight)
      : newWeight;
    this._entries.set(id, {
      id,
      basin,
      weight: finalWeight,
      correct: opts.correct,
      category: opts.category ?? existing?.category ?? '',
      trajectory: opts.trajectory ?? existing?.trajectory ?? {},
    });
    this.evictOldestIfFull();
  }

  /** Store a basin without an outcome (default weight=1.0, correct=null).
   *  Caller will attribute the outcome later via `recordOutcome`. */
  store(
    id: string,
    basin: Basin,
    opts: { category?: string; trajectory?: Record<string, unknown> } = {},
  ): void {
    const existing = this._entries.get(id);
    this._entries.set(id, {
      id,
      basin,
      weight: 1.0,
      correct: null,
      category: opts.category ?? existing?.category ?? '',
      trajectory: opts.trajectory ?? existing?.trajectory ?? {},
    });
    this.evictOldestIfFull();
  }

  /** LRU eviction by insertion order. Map iteration order is insertion
   *  order, and Map.set on an existing key preserves that position —
   *  so re-integrating an existing id does NOT count as a fresh insert
   *  and does not displace another. Only true new-id inserts that push
   *  size above QIGRAMV2_HISTORY_MAX trigger eviction of the oldest. */
  private evictOldestIfFull(): void {
    while (this._entries.size > QIGRAMV2_HISTORY_MAX) {
      const oldestKey = this._entries.keys().next().value;
      if (oldestKey === undefined) return;
      this._entries.delete(oldestKey);
    }
  }

  /** Attribute an outcome to a previously-stored basin entry.
   *
   *  TODO(follow-up PR): wire this call from the trade-close path
   *  (likely `resonance_bank.ts` after a closed-trade row is written,
   *  or from the post-trade pnl-attribution job in `loop.ts`). For
   *  this PR the method exists so v2 unit tests can exercise the
   *  decay / wrong-answer / κ-tacking paths without that wiring.
   */
  recordOutcome(id: string, correct: boolean): boolean {
    const entry = this._entries.get(id);
    if (!entry) return false;
    if (correct) {
      // On a correct outcome, leave the existing weight alone (it
      // already represents storage-time confidence) and just mark
      // correctness. This matches canonical `max(old, new)` when the
      // weight at attribution is 0 (we don't downgrade good basins).
      this._entries.set(id, { ...entry, correct: true });
    } else {
      // Wrong → zero the weight, mark dead.
      this._entries.set(id, { ...entry, correct: false, weight: 0.0 });
    }
    return true;
  }

  // ── Decay ─────────────────────────────────────────────────────────

  /** Decay all weights by DECAY_FACTOR (canonical `decay_all`). */
  decayAll(): void {
    for (const [id, entry] of this._entries) {
      this._entries.set(id, { ...entry, weight: entry.weight * DECAY_FACTOR });
    }
  }

  // ── Consolidation ─────────────────────────────────────────────────

  /** Remove dead-weight entries — a tombstone reaper, NOT a destructive
   *  op. Mirrors the eviction subset of qig-core 2.8.0
   *  `SleepCycleManager.consolidate()`.
   *
   *  SEPARATE from `decayAll()`: decay reduces weight every tick;
   *  `consolidate()` REMOVES entries that decay has already driven dead
   *  (weight ≤ MIN_ACTIVE_WEIGHT — the same line `activeEntries()` draws,
   *  so the two views never disagree about what is alive). Without this,
   *  `_entries` grows unboundedly with session uptime: the sovereignty
   *  denominator (`_entries.size`) — and therefore `baseFrac = Φ ×
   *  sovereignty × maturity` position sizing — decays toward zero.
   *
   *  Because consolidate() cannot touch a live (above-threshold) entry,
   *  it is SAFE for the caller to pair it with `decayAll()` on every
   *  tick. The earlier phase-gating guidance assumed the richer
   *  destructive semantics of qig-core's SleepCycleManager — it does
   *  not apply to this reduced TS port.
   *
   *  Returns the number of entries pruned.
   */
  consolidate(): number {
    let pruned = 0;
    for (const [id, entry] of this._entries) {
      if (entry.weight <= MIN_ACTIVE_WEIGHT) {
        this._entries.delete(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  // ── Recall ────────────────────────────────────────────────────────

  /** Find nearest ACTIVE basin by Fisher-Rao distance.
   *
   *  Only basins with weight > MIN_ACTIVE_WEIGHT participate.
   *  Returns null when no active entries exist. */
  recall(query: Basin): RecallResultV2 | null {
    let nearestId: string | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    let nearestEntry: BasinEntryV2 | null = null;
    for (const entry of this._entries.values()) {
      if (entry.weight <= MIN_ACTIVE_WEIGHT) continue;
      const d = fisherRao(query, entry.basin);
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = entry.id;
        nearestEntry = entry;
      }
    }
    if (nearestId === null || nearestEntry === null) return null;
    return {
      source: nearestId,
      d_FR: nearestDist,
      weight: nearestEntry.weight,
      correct: nearestEntry.correct,
      trajectory: nearestEntry.trajectory,
      category: nearestEntry.category,
    };
  }

  /** "Wormhole shortcut": find the highest-weighted active basin
   *  matching a category. Returns null if no active entries match. */
  recallByCategory(category: string): CategoryRecallResultV2 | null {
    let bestId: string | null = null;
    let bestWeight = -Infinity;
    let bestEntry: BasinEntryV2 | null = null;
    for (const entry of this._entries.values()) {
      if (entry.weight <= MIN_ACTIVE_WEIGHT) continue;
      if (entry.category !== category) continue;
      if (entry.weight > bestWeight) {
        bestWeight = entry.weight;
        bestId = entry.id;
        bestEntry = entry;
      }
    }
    if (bestId === null || bestEntry === null) return null;
    return {
      source: bestId,
      weight: bestEntry.weight,
      correct: bestEntry.correct,
      trajectory: bestEntry.trajectory,
      category: bestEntry.category,
    };
  }

  // ── κ tacking ─────────────────────────────────────────────────────

  /** Update κ based on confidence + correctness. Direct canonical
   *  translation of `QIGRAMv2.tack`:
   *
   *    if correct and dominance > 0.7:  κ ← min(κ+2, 128)
   *    elif not correct:                κ ← max(κ-3, 32)
   *    κ ← κ + (64 - κ) * 0.1   (drift toward fixed point, always)
   */
  tack(confidence: number, correct: boolean): void {
    if (correct && confidence > KAPPA_CONFIDENCE_THRESHOLD) {
      this._kappa = Math.min(this._kappa + KAPPA_UP_STEP, KAPPA_MAX);
    } else if (!correct) {
      this._kappa = Math.max(this._kappa - KAPPA_DOWN_STEP, KAPPA_MIN);
    }
    // Drift toward fixed point — applies on every call.
    this._kappa += (KAPPA_FIXED_POINT - this._kappa) * KAPPA_DRIFT;
  }

  // ── Hydration from legacy persisted tuples ────────────────────────

  /** Bulk-load entries from a legacy persistence layer.
   *  Entries without `weight` / `correct` / `category` default to
   *  `weight=1.0, correct=null, category=""`. Matches the
   *  "optional persisted fields" requirement. */
  loadFromLegacy(rows: ReadonlyArray<{
    id: string;
    basin: Basin;
    weight?: number | null;
    correct?: boolean | null;
    category?: string | null;
    trajectory?: Record<string, unknown> | null;
  }>): void {
    for (const r of rows) {
      this._entries.set(r.id, {
        id: r.id,
        basin: r.basin,
        weight: r.weight ?? 1.0,
        correct: r.correct ?? null,
        category: r.category ?? '',
        trajectory: r.trajectory ?? {},
      });
    }
  }
}

// ─── Per-symbol partition ────────────────────────────────────────────

/** Per-symbol partition over QIGRAMv2State. Each MonkeyKernel handles
 *  DEFAULT_SYMBOLS (currently 2) and integrates one basin per symbol
 *  per tick. With a single shared QIGRAMv2State, the LRU cap at
 *  QIGRAMV2_HISTORY_MAX (100) only covers ~100/N_SYMBOLS ticks of
 *  age before eviction — for N_SYMBOLS = 2 that is ~49 ticks, far
 *  below the ~90 ticks needed for 0.95^k decay to cross
 *  MIN_ACTIVE_WEIGHT, so sov pins at 1.0 in steady state.
 *
 *  Per-symbol partition isolates each symbol's LRU buffer so
 *  HISTORY_MAX = 100 covers ≥ 90-tick decay-to-threshold on every
 *  symbol independently. Bonus: per-symbol sov is a more informative
 *  signal than the conflated aggregate (mirrors the per-symbol
 *  SelfObservation asymmetry surfaced by PR #911).
 *
 *  Empty partitions return sov=1.0 ("no information yet"); the kernel
 *  treats that the same as a freshly-warmed legitimate 1.0. */
export class QIGRAMv2Partition {
  private readonly stores: Map<string, QIGRAMv2State> = new Map();
  private readonly totalProblemsPerSymbol: number | null;

  constructor(totalProblemsPerSymbol: number | null = null) {
    this.totalProblemsPerSymbol = totalProblemsPerSymbol;
  }

  private storeFor(symbol: string): QIGRAMv2State {
    let s = this.stores.get(symbol);
    if (!s) {
      s = new QIGRAMv2State(this.totalProblemsPerSymbol);
      this.stores.set(symbol, s);
    }
    return s;
  }

  integrate(
    symbol: string,
    id: string,
    basin: Basin,
    opts: {
      weight: number;
      correct: boolean;
      category?: string;
      trajectory?: Record<string, unknown>;
    },
  ): void {
    this.storeFor(symbol).integrate(id, basin, opts);
  }

  store(
    symbol: string,
    id: string,
    basin: Basin,
    opts: { category?: string; trajectory?: Record<string, unknown> } = {},
  ): void {
    this.storeFor(symbol).store(id, basin, opts);
  }

  decayAll(symbol: string): void {
    const s = this.stores.get(symbol);
    if (s) s.decayAll();
  }

  /** Explicit cleanup of a symbol's dead-weight entries. Not required
   *  per-tick under LRU; useful before persistence or after a wrong-
   *  outcome attribution burst. */
  consolidate(symbol: string): number {
    const s = this.stores.get(symbol);
    return s ? s.consolidate() : 0;
  }

  recordOutcome(symbol: string, id: string, correct: boolean): boolean {
    const s = this.stores.get(symbol);
    return s ? s.recordOutcome(id, correct) : false;
  }

  recall(symbol: string, query: Basin): RecallResultV2 | null {
    const s = this.stores.get(symbol);
    return s ? s.recall(query) : null;
  }

  recallByCategory(symbol: string, category: string): CategoryRecallResultV2 | null {
    const s = this.stores.get(symbol);
    return s ? s.recallByCategory(category) : null;
  }

  tack(symbol: string, confidence: number, correct: boolean): void {
    this.storeFor(symbol).tack(confidence, correct);
  }

  kappa(symbol: string): number {
    const s = this.stores.get(symbol);
    return s ? s.kappa : KAPPA_FIXED_POINT;
  }

  activeEntries(symbol: string): BasinEntryV2[] {
    const s = this.stores.get(symbol);
    return s ? s.activeEntries() : [];
  }

  totalEntries(symbol: string): number {
    const s = this.stores.get(symbol);
    return s ? s.totalEntries : 0;
  }

  /** Sovereignty for a single symbol. Empty partition returns 1.0
   *  ("no information") so a cold-start symbol does not inject a
   *  spurious 0 into baseFrac = Φ × sov × maturity. */
  sovereignty(symbol: string): number {
    const s = this.stores.get(symbol);
    if (!s || s.totalEntries === 0) return 1.0;
    return s.sovereignty;
  }

  /** All symbols currently tracked. Useful for telemetry. */
  symbols(): string[] {
    return Array.from(this.stores.keys());
  }
}

// ─── Env-flag helper ─────────────────────────────────────────────────

/** Returns true when the operator has explicitly enabled the v2 layer.
 *  Default is OFF; with the flag unset, callers must keep their
 *  legacy behavior. */
export function isQigramV2Enabled(): boolean {
  return process.env['L_QIGRAM_V2_ENABLED'] === 'true';
}
