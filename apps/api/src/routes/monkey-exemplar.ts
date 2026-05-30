/**
 * monkey-exemplar.ts — ingress for the CC→kernel exemplar-observation channel
 * (poloniex-trading-platform#1033, PR1: WRITE-ONLY / dark).
 *
 * The CC exemplar trader (bootstrap: Claude; future: Gemma/Ollama) POSTs its
 * per-cycle DECISION here — including deliberate ABSTENTIONS — so the kernel
 * can later observe "what good looks like" and tell a chosen stand-aside from
 * absence. No kernel consumption yet; PR2 wires that behind a flag.
 *
 * Auth: shared secret `CC_EXEMPLAR_SECRET` via `x-exemplar-secret` header
 * (constant-time compare), so the external exemplar can write without a user
 * JWT. Writes are BEST-EFFORT and must never affect trading/safety.
 */
import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const VALID_ACTIONS = ['enter', 'hold', 'exit', 'abstain'] as const;
type ExemplarAction = (typeof VALID_ACTIONS)[number];

export interface NormalizedExemplarDecision {
  source: string;
  symbol: string | null;
  action: ExemplarAction;
  isAbstain: boolean;
  side: 'short' | 'long' | null;
  conviction: number | null;
  regime: string | null;
  kernelSignals: unknown;
  price: number | null;
  reasoning: string | null;
  outcomePnl: number | null;
  outcomeR: number | null;
}

/**
 * Pure validation/normalization of an exemplar decision payload. Kept pure so
 * the decision SEMANTICS are unit-testable without a DB:
 *   - action must be one of enter|hold|exit|abstain.
 *   - abstain ALWAYS implies side=null and isAbstain=true (a deliberate flat,
 *     not a directional bet) — this is what lets the kernel distinguish a
 *     chosen stand-aside from absence.
 *   - non-abstain MAY carry a side; side is coerced to short|long|null.
 */
export function normalizeExemplarDecision(
  body: Record<string, unknown>,
): { ok: true; value: NormalizedExemplarDecision } | { ok: false; error: string } {
  const action = String(body.action ?? '').toLowerCase();
  if (!VALID_ACTIONS.includes(action as ExemplarAction)) {
    return { ok: false, error: `action must be one of ${VALID_ACTIONS.join('|')}` };
  }
  const isAbstain = action === 'abstain';
  const rawSide = String(body.side ?? '').toLowerCase();
  const side: 'short' | 'long' | null = isAbstain
    ? null
    : rawSide === 'short' || rawSide === 'long'
      ? rawSide
      : null;
  const num = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    ok: true,
    value: {
      source: typeof body.source === 'string' && body.source.length > 0 ? body.source : 'cc_bootstrap',
      symbol: typeof body.symbol === 'string' && body.symbol.length > 0 ? body.symbol : null,
      action: action as ExemplarAction,
      isAbstain,
      side,
      conviction: num(body.conviction),
      regime: typeof body.regime === 'string' ? body.regime : null,
      kernelSignals: body.kernelSignals ?? null,
      price: num(body.price),
      reasoning: typeof body.reasoning === 'string' ? body.reasoning : null,
      outcomePnl: num(body.outcomePnl),
      outcomeR: num(body.outcomeR),
    },
  };
}

function validSecret(provided: string | undefined): boolean {
  const expected = process.env.CC_EXEMPLAR_SECRET?.trim();
  if (!expected || expected === 'CHANGE_ME') return false;
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/observe', async (req: Request, res: Response) => {
  if (!validSecret(req.header('x-exemplar-secret'))) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const norm = normalizeExemplarDecision((req.body ?? {}) as Record<string, unknown>);
  if (norm.ok === false) return res.status(400).json({ ok: false, error: norm.error });
  const d = norm.value;
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO monkey_exemplar_decisions
         (source, symbol, action, is_abstain, side, conviction, regime,
          kernel_signals, price, reasoning, outcome_pnl, outcome_r)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        d.source, d.symbol, d.action, d.isAbstain, d.side, d.conviction, d.regime,
        d.kernelSignals === null ? null : JSON.stringify(d.kernelSignals),
        d.price, d.reasoning, d.outcomePnl, d.outcomeR,
      ],
    );
    return res.json({ ok: true, id: result.rows[0]?.id ?? null });
  } catch (err) {
    // Best-effort: never block the exemplar's loop on a write failure.
    logger.warn('[exemplar] observe insert failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
    });
    return res.status(200).json({ ok: false, error: 'write_failed_noop' });
  }
});

router.get('/recent', async (req: Request, res: Response) => {
  if (!validSecret(req.header('x-exemplar-secret'))) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : null;
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  try {
    const result = symbol
      ? await pool.query(
          `SELECT * FROM monkey_exemplar_decisions WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`,
          [symbol, limit],
        )
      : await pool.query(
          `SELECT * FROM monkey_exemplar_decisions ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );
    return res.json({ ok: true, rows: result.rows });
  } catch (err) {
    return res.status(200).json({ ok: false, error: 'read_failed', rows: [] });
  }
});

export default router;
