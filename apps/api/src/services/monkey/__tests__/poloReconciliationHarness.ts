/**
 * Polo CSV + Reconciliation Smoke Harness (for three-bug single PR TDD)
 *
 * Purpose: Load the user's exact Polo CSV data (4.5h/92 trades/net −$7, 6.6× per-trade,
 * 0/925 tier-1, +315.21/-1.03 and +374.12/+0.0026 phantom examples, 0.042% avg win, etc.)
 * and provide helpers to run the residual 6× audit + post-fix reconciliation checks
 * against DB autonomous_trades rows.
 *
 * This is a test harness only. It does not modify production code.
 *
 * Usage in TDD steps (see compliant TDD plan 2026-05-27_compliant-TDD-plan...):
 * - Part A (LIVED ONLY 5 / 6× root cause): load user's Polo CSV, compute per-trade realized PnL,
 *   compare to DB rows (pre- and post-fix), assert no 6.6× inflation and specific phantom cases
 *   no longer appear as written values.
 * - Part B/C interaction tests: same harness with small-win history + chop sequences.
 *
 * The actual CSV files are user-provided (telemetry_*.csv in analysis/ are derived).
 * This harness expects a CSV with columns matching the user's incident data
 * (at minimum: symbol, side, entry_price, exit_price, quantity, realized_pnl, order_id or equivalent).
 *
 * Commands to run (examples for TDD evidence):
 *   yarn vitest run ... -t 'polo|6x|phantom' --reporter=verbose
 *   (or equivalent pytest if ported to ml-worker tests)
 */

import { readFileSync } from 'fs';

/**
 * Minimal CSV parser — no external dep. Handles double-quoted fields
 * (Polo CSVs wrap order IDs in extra-quoted form like `"""582641…"""`),
 * embedded commas inside quotes, and CRLF line endings.
 *
 * Returns an array of records keyed by the header row.
 */
function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (c === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = splitRow(lines[0]!).map((h) => h.trim());
  return lines.slice(1).map((row) => {
    const fields = splitRow(row);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = (fields[i] ?? '').trim(); });
    return rec;
  });
}

export interface PoloTradeRow {
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  entry_price: number;
  exit_price: number;
  quantity: number;
  realized_pnl: number;
  order_id?: string;
  [key: string]: unknown;
}

export interface ReconciliationResult {
  totalPoloPnl: number;
  totalDbPnl: number;
  ratio: number; // db / polo — expect ~1.0 post-fix, ~6.6 pre-fix on the sample
  phantomRows: Array<{ row: PoloTradeRow; dbPnl: number; divergence: number }>;
}

/**
 * Load the user's Polo CSV export (exact 4.5h/92-trade sample from incident).
 * The path is expected to be provided by the TDD runner / CI (user-supplied file).
 */
export function loadPoloCsv(csvPath: string): PoloTradeRow[] {
  const content = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(content);

  return rows.map((row) => ({
    symbol: String(row.symbol || row.Symbol || row.Futures || ''),
    side: normalizeSide(row.side || row.Side || row.direction || ''),
    entry_price: Number(row.entry_price || row.entryPrice || row['Entry Price'] || 0),
    exit_price: Number(row.exit_price || row.exitPrice || row['Exit Price'] || 0),
    quantity: Math.abs(Number(row.quantity || row.size || row['Order Size'] || row['Amount'] || 0)),
    realized_pnl: Number(row.realized_pnl || row.realisedPnl || row.pnl || row.PnL || row['Closed PnL'] || 0),
    order_id: row.order_id || row.orderId || row['Order ID'] || undefined,
  }));
}

function normalizeSide(s: string): 'long' | 'short' | 'buy' | 'sell' {
  const v = String(s).toLowerCase();
  if (v.includes('long') || v === 'buy') return 'long';
  if (v.includes('short') || v === 'sell') return 'short';
  return 'long';
}

/**
 * Given loaded Polo rows and a map of DB rows (by order_id or approximate match),
 * compute the reconciliation.
 *
 * In real TDD execution this would query the test DB or use the injected rows
 * from the negative tests.
 */
export function reconcilePoloVsDb(
  poloRows: PoloTradeRow[],
  dbRowsByKey: Map<string, { pnl: number; quantity: number; entry_price: number }>,
): ReconciliationResult {
  let totalPolo = 0;
  let totalDb = 0;
  const phantomRows: ReconciliationResult['phantomRows'] = [];

  for (const p of poloRows) {
    totalPolo += p.realized_pnl;

    // Best-effort key (order_id preferred; fall back to symbol+side+approx entry)
    const key = p.order_id || `${p.symbol}|${p.side}|${p.entry_price.toFixed(0)}`;
    const db = dbRowsByKey.get(key);

    if (db) {
      totalDb += db.pnl;
      const divergence = Math.abs(db.pnl - p.realized_pnl);
      if (divergence > 5) {
        phantomRows.push({ row: p, dbPnl: db.pnl, divergence });
      }
    }
  }

  const ratio = totalPolo !== 0 ? totalDb / totalPolo : 0;

  return {
    totalPoloPnl: totalPolo,
    totalDbPnl: totalDb,
    ratio,
    phantomRows,
  };
}

/**
 * Convenience: run the exact numbers from the user's incident on a given DB snapshot.
 * Used in negative tests to prove pre-fix 6.6× and post-fix 1.0×.
 */
export function runIncidentReconciliation(
  poloCsvPath: string,
  dbSnapshot: Map<string, { pnl: number; quantity: number; entry_price: number }>,
) {
  const rows = loadPoloCsv(poloCsvPath);
  return reconcilePoloVsDb(rows, dbSnapshot);
}