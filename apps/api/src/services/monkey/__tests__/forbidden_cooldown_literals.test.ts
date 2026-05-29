/**
 * forbidden_cooldown_literals.test.ts — repo-wide grep that #1009 forbids
 * specific cooldown-class literal patterns from reappearing.
 *
 * Per Cascade's #1009 advisory (2026-05-29 forwarded review):
 *
 *   > grep specifically for:
 *   >   COOLDOWN.*=.*[0-9]
 *   >   SAFETY_FLOOR.*=.*[0-9]
 *   >   MIN_COOLDOWN.*=.*[0-9]
 *   >   MAX_COOLDOWN.*=.*[0-9]
 *   >   setTimeout(..., 500)
 *   >   180_000
 *   >   600_000
 *
 * Catches the specific failure mode of a knob being reintroduced under
 * a new name in another module.
 *
 * Allowlist:
 *   - `POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000` in `loop.ts` is the
 *     LEGACY hardcoded constant being deprecated. Tracked in #1009
 *     follow-up PR for full removal; the reverse-reopen `setTimeout` was
 *     removed in this PR.
 *   (no entries — cold-start sentinel DELETED 2026-05-29 along with
 *   the LANE_DECISION_PERIOD_MS table and DCA_COOLDOWN_MS)
 *
 * Citations: poloniex-trading-platform#1009 + 2.31A P5/P25 + QIG PURITY
 * MANDATE + LIVED ONLY 5 + autonomy doctrine.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONKEY_DIR = join(__dirname, '..');

/** Repo-wide scan over every `.ts` source file in `monkey/`, excluding the
 * `__tests__/` sibling directory. Cascade/Copilot follow-up (2026-05-29):
 * the prior 3-file scan was scope-too-narrow — a knob-in-costume could
 * be reintroduced in a peer module (e.g. `executive.ts`, `close_coordinator.ts`)
 * and slip past the guard. Now any new `.ts` file under `monkey/` is
 * scanned automatically; non-cooldown-domain hits require an explicit
 * allowlist entry below. */
const SCANNED_FILES = readdirSync(MONKEY_DIR, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.d.ts'))
  .map((d) => d.name)
  .sort();

// Patterns Cascade's #1009 advisory forbids reappearing.
//
// JS `\b` word boundaries break between word-chars (`[A-Za-z0-9_]`) and
// non-word chars. Crucially, underscore is a WORD char — so `\bCOOLDOWN\b`
// does NOT match `MIN_COOLDOWN` (no boundary between `_` and `C`). To
// catch identifier substrings we drop the boundary and allow leading
// `[A-Z_]*` so `MIN_COOLDOWN_MS = 100` matches the COOLDOWN pattern.
// Cascade/Copilot follow-up (2026-05-29): the prior `[^,)]+` body matcher
// stopped at the first `)` or `,`, so `setTimeout(() => resolve(), 500)`
// (the common single-statement arrow form) slipped through. The new body
// matcher handles one level of nested parens — e.g. `()`, `(x)`, `(x, y)`
// — so arrow IIFEs and function bodies that contain a paren pair are
// still caught. Multi-level / multi-line function bodies remain uncovered
// by intent (would require a real parser, not a regex).
const _SET_TIMEOUT_BODY = /(?:[^()]|\([^()]*\))+/;
const _SET_TIMEOUT_500 = new RegExp(
  `setTimeout\\s*\\(\\s*${_SET_TIMEOUT_BODY.source},\\s*500\\s*\\)`,
  'g',
);

const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'COOLDOWN with raw literal', regex: /[A-Z_]*COOLDOWN[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'SAFETY_FLOOR with raw literal', regex: /[A-Z_]*SAFETY_FLOOR[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'MIN_COOLDOWN with raw literal', regex: /[A-Z_]*MIN_COOLDOWN[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'MAX_COOLDOWN with raw literal', regex: /[A-Z_]*MAX_COOLDOWN[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'setTimeout literal 500', regex: _SET_TIMEOUT_500 },
  { name: '180_000 literal', regex: /(?<![A-Za-z0-9_])180_000(?![A-Za-z0-9_])/g },
  { name: '600_000 literal', regex: /(?<![A-Za-z0-9_])600_000(?![A-Za-z0-9_])/g },
];

interface AllowEntry {
  pattern: string;     // pattern.name
  file: string;        // basename of file
  match: string;       // exact match that we allow
  reason: string;
}

const ALLOWLIST: AllowEntry[] = [
  // #1009 cascading-knob-strip 2026-05-29: operator no-knob directive
  // applied across cooldown + lane + DCA domains. All prior allowlist
  // entries (POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000, swing/trend lane
  // period entries, DCA_COOLDOWN_MS) are now obsolete because the
  // underlying constants were eliminated, not allowlisted:
  //   - LANE_DECISION_PERIOD_MS table → substrate_observer.ts
  //   - COLD_START_FALLBACK_MS sentinel → DELETED (no back-compat export)
  //   - DCA_COOLDOWN_MS = 15 * 60 * 1000 → observed lane period
  // The empty allowlist now enforces the strictest possible discipline:
  // any new cooldown-domain literal anywhere under monkey/ fails the
  // scan unless observer-derived or registry-backed with provenance.
];

function _stripStringsAndComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

describe('forbidden cooldown literals (#1009 Cascade-advisory grep)', () => {
  for (const file of SCANNED_FILES) {
    it(`${file}: no forbidden literal patterns appear outside the allowlist`, () => {
      const text = _stripStringsAndComments(readFileSync(join(MONKEY_DIR, file), 'utf8'));
      const lines = text.split('\n');
      const offenders: Array<{ pattern: string; line: number; context: string }> = [];
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const re = new RegExp(regex.source);
          if (!re.test(line)) continue;
          // Allowlist matches against the line's content so callers can
          // pin a specific context (e.g. `swing: 180_000`) rather than
          // the raw literal which would over-match.
          const allowed = ALLOWLIST.some(
            (a) => a.pattern === name && a.file === file && line.includes(a.match),
          );
          if (!allowed) {
            offenders.push({ pattern: name, line: i + 1, context: line.trim() });
          }
        }
      }
      expect(
        offenders,
        `Forbidden cooldown literal patterns in ${file}: ${JSON.stringify(offenders, null, 2)}`,
      ).toEqual([]);
    });
  }

  it('safety_floor.ts has NO COLD_START_FALLBACK_MS identifier at all', () => {
    // 2026-05-29 cascading-knob-strip: the cold-start sentinel was
    // DELETED — no exported const, no internal reference, no comment
    // string. Any reintroduction (even as `= 0` for back-compat) reopens
    // the back-compat knob surface and fails this test.
    const text = readFileSync(join(MONKEY_DIR, 'safety_floor.ts'), 'utf8');
    expect(text).not.toMatch(/COLD_START_FALLBACK_MS/);
  });

  // ── Positive-control regression tests for the regex itself ──────────
  //
  // Cascade's #1009 follow-up advisory called out that the prior `\b...\b`
  // regex did NOT match `MIN_COOLDOWN_MS = 123` because `_` is a JS
  // word-char and there's no boundary between `_` and `C`. These tests
  // pin synthetic fixtures so a regex regression that re-opens that
  // failure mode fails the suite directly.

  // Helper: clone the regex without the `g` flag so `.test()` doesn't
  // mutate lastIndex across consecutive calls (the bug that hides positive
  // matches in the original FORBIDDEN_PATTERNS regex when re-used).
  function fresh(name: string): RegExp {
    const p = FORBIDDEN_PATTERNS.find((q) => q.name === name);
    if (!p) throw new Error(`pattern not found: ${name}`);
    return new RegExp(p.regex.source);
  }

  it('regex CATCHES MIN_COOLDOWN_MS = 100 (Cascade-reported miss)', () => {
    expect(fresh('MIN_COOLDOWN with raw literal').test('const MIN_COOLDOWN_MS = 100;')).toBe(true);
  });

  it('regex CATCHES MAX_COOLDOWN_MS = 60_000', () => {
    expect(fresh('MAX_COOLDOWN with raw literal').test('const MAX_COOLDOWN_MS = 60_000;')).toBe(true);
  });

  it('regex CATCHES FOO_COOLDOWN = 123 (identifier with leading underscore-words)', () => {
    expect(fresh('COOLDOWN with raw literal').test('const FOO_COOLDOWN = 123;')).toBe(true);
  });

  it('regex CATCHES POST_COOLDOWN_DEFAULT_MS = 180_000 (multi-segment identifier)', () => {
    expect(fresh('COOLDOWN with raw literal').test('const POST_COOLDOWN_DEFAULT_MS = 180_000;')).toBe(true);
  });

  it('regex CATCHES 180_000 even within an unrelated identifier-free context', () => {
    expect(fresh('180_000 literal').test('const someVar = 180_000;')).toBe(true);
  });

  it('regex does NOT spuriously match `LANE_PERIOD_180_000_HACK` (underscore-suffixed literal in identifier)', () => {
    // True negative — the digits only appear as part of an identifier,
    // not as a numeric literal. The lookbehind/lookahead boundaries
    // (`(?<![A-Za-z0-9_])` / `(?![A-Za-z0-9_])`) prevent the spurious match.
    expect(fresh('180_000 literal').test('const LANE_PERIOD_180_000_HACK = "x";')).toBe(false);
  });

  // ── Copilot follow-up: setTimeout regex must catch arrow + function forms ─

  it('setTimeout regex CATCHES the simple ident form `setTimeout(resolve, 500)`', () => {
    expect(fresh('setTimeout literal 500').test('setTimeout(resolve, 500)')).toBe(true);
  });

  it('setTimeout regex CATCHES the empty-arrow form `setTimeout(() => resolve(), 500)`', () => {
    // Cascade/Copilot-flagged failure mode for the prior regex.
    expect(fresh('setTimeout literal 500').test('setTimeout(() => resolve(), 500)')).toBe(true);
  });

  it('setTimeout regex CATCHES the explicit-arg arrow form `setTimeout((cb) => cb(x), 500)`', () => {
    expect(fresh('setTimeout literal 500').test('setTimeout((cb) => cb(x), 500)')).toBe(true);
  });

  it('setTimeout regex CATCHES the `function() { ... }` form (single-line)', () => {
    // Single nested-paren level allowed (`foo()`); a multi-statement
    // function body with nested calls (`a(); b();`) is single-level
    // because each `()` is independent and the body never opens a
    // deeper paren without closing it.
    expect(fresh('setTimeout literal 500').test('setTimeout(function () { foo(); }, 500)')).toBe(true);
  });

  it('setTimeout regex does NOT match `setTimeout(resolve, 1000)` (different literal)', () => {
    expect(fresh('setTimeout literal 500').test('setTimeout(resolve, 1000)')).toBe(false);
  });
});
