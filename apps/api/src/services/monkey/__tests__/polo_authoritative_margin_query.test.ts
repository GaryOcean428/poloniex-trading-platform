/**
 * polo_authoritative_margin_query.test.ts — regression guard for the
 * column-name bug fixed in PR #1001 (qty → quantity).
 *
 * 2026-05-28 incident: applyPoloRealizedPnlAfterClose computed the
 * per-close-group margin via:
 *   SELECT SUM(COALESCE(entry_price, 0) * COALESCE(qty, 0) / ...) AS margin_usdt
 *     FROM autonomous_trades WHERE id = ANY($1)
 *
 * The autonomous_trades table has no `qty` column (the column is
 * `quantity`, per migrations 048 + 060). Postgres raised an
 * undefined-column error, the surrounding `.catch` non-fatal block
 * swallowed it silently at LOG_LEVEL=info, marginUsdt stayed at the
 * fallback `1`, and the polo_authoritative_close reward push fired
 * with pnlFrac inflated 30–500× (visible in the b8139a81 deploy log
 * as values like `pnlFrac=-343.79%`).
 *
 * Existing tests stub marginUsdt directly via pushReward and never
 * exercise the SQL query, so the bug had no test coverage. This file
 * is the regression guard: it asserts the live source file uses the
 * correct column name (`quantity`) and not the buggy one (`qty`).
 * Catches the specific drift without needing a live DB.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOOP_TS_PATH = join(__dirname, '..', 'loop.ts');

function extractMarginQueryBlock(): string {
  const src = readFileSync(LOOP_TS_PATH, 'utf8');
  // Pull the line containing the margin SUM query.
  const match = src.match(/SELECT SUM\(COALESCE\(entry_price[\s\S]*?AS margin_usdt[\s\S]*?FROM autonomous_trades[\s\S]*?ANY\(\$1\)/);
  if (!match) {
    throw new Error('Could not locate the polo-authoritative margin SUM query in loop.ts');
  }
  return match[0];
}

describe('polo-authoritative margin query (regression guard for PR #1001)', () => {
  it('uses the `quantity` column from autonomous_trades', () => {
    const sql = extractMarginQueryBlock();
    expect(sql).toMatch(/COALESCE\(quantity,\s*0\)/);
  });

  it('does NOT reference the non-existent `qty` column', () => {
    const sql = extractMarginQueryBlock();
    // Word-boundary check so 'quantity' doesn't accidentally match 'qty'.
    expect(sql).not.toMatch(/\bqty\b/);
  });

  it('continues to reference entry_price + leverage (other valid columns)', () => {
    const sql = extractMarginQueryBlock();
    expect(sql).toMatch(/COALESCE\(entry_price,\s*0\)/);
    expect(sql).toMatch(/COALESCE\(leverage,\s*16\)/);
  });
});
