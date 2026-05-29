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
 *   - `COLD_START_FALLBACK_MS = 500` in `safety_floor.ts` is the one
 *     explicitly-named sentinel (replaces the legacy 500ms wait during
 *     observer warmup). Allowlisted by name.
 *
 * Citations: poloniex-trading-platform#1009 + 2.31A P5/P25 + QIG PURITY
 * MANDATE + LIVED ONLY 5 + autonomy doctrine.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONKEY_DIR = join(__dirname, '..');

/** Files that get scanned. The set is deliberately small + named so
 * adding a new cooldown-class module forces an explicit allowlist
 * decision per #1009. */
const SCANNED_FILES = [
  'safety_floor.ts',
  'cooldown_composer.ts',
  'loop.ts',
];

// Patterns Cascade's #1009 advisory forbids reappearing.
//
// JS `\b` word boundaries break between word-chars (`[A-Za-z0-9_]`) and
// non-word chars. Crucially, underscore is a WORD char — so `\bCOOLDOWN\b`
// does NOT match `MIN_COOLDOWN` (no boundary between `_` and `C`). To
// catch identifier substrings we drop the boundary and allow leading
// `[A-Z_]*` so `MIN_COOLDOWN_MS = 100` matches the COOLDOWN pattern.
const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'COOLDOWN with raw literal', regex: /[A-Z_]*COOLDOWN[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'SAFETY_FLOOR with raw literal', regex: /[A-Z_]*SAFETY_FLOOR[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'MIN_COOLDOWN with raw literal', regex: /[A-Z_]*MIN_COOLDOWN[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'MAX_COOLDOWN with raw literal', regex: /[A-Z_]*MAX_COOLDOWN[A-Z_]*\s*[:=]\s*\d/g },
  { name: 'setTimeout literal 500', regex: /setTimeout\([^,)]+,\s*500\s*\)/g },
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
  {
    pattern: '180_000 literal',
    file: 'loop.ts',
    match: 'POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000',
    reason:
      'Legacy hardcoded POST_CLOSE_COOLDOWN — #1009 PR2 follow-up removes this. '
      + 'PR1 (current) only replaces the reverse-reopen 500ms; the 180_000ms ' +
      'tilt-chain wall is deferred (per Cascade advisory).',
  },
  {
    pattern: 'COOLDOWN with raw literal',
    file: 'loop.ts',
    match: 'POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000',
    reason:
      'Same legacy constant under the COOLDOWN identifier-substring pattern. '
      + 'PR2 follow-up removes it; allowlisted under both patterns until then.',
  },
  {
    pattern: '180_000 literal',
    file: 'loop.ts',
    match: 'swing: 180_000',
    reason:
      'LANE_DECISION_PERIOD_MS entry for the swing lane — substrate tick '
      + 'cadence, not a cooldown floor. Different domain (the kernel cannot '
      + 'act faster than its tick period regardless of what the cooldown '
      + 'composer says — see cooldown_composer.ts tick_cadence floor).',
  },
  {
    pattern: '600_000 literal',
    file: 'loop.ts',
    match: 'trend: 600_000',
    reason:
      'LANE_DECISION_PERIOD_MS entry for the trend lane — substrate tick '
      + 'cadence, not a cooldown floor. Same justification as the swing '
      + 'lane entry above.',
  },
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

  it('the COLD_START_FALLBACK_MS sentinel is the only named cooldown literal in safety_floor.ts', () => {
    const text = readFileSync(join(MONKEY_DIR, 'safety_floor.ts'), 'utf8');
    expect(text).toContain('export const COLD_START_FALLBACK_MS = 500;');
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
});
