/**
 * loop_account.ts — exchange account-context fetch for the Monkey kernel.
 * Extracted verbatim from loop.ts (2026-05-14 modularization). This is a
 * pure async helper — no kernel state, no `this` — so it lives as a free
 * function. Behaviour is identical to the former MonkeyKernel method.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import { apiCredentialsService } from '../apiCredentialsService.js';
import poloniexFuturesService from '../poloniexFuturesService.js';
import { resolveExchangePositionSide } from '../exchangePositionSide.js';

export async function fetchAccountContext(symbol: string): Promise<{
  equityFraction: number;
  marginFraction: number;
  openPositions: number;
  heldSide: 'long' | 'short' | null;
  availableEquity: number;
}> {
  try {
    const userRow = await pool.query(
      `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
    );
    const userId = (userRow.rows[0] as { user_id?: string } | undefined)?.user_id;
    if (!userId) {
      return { equityFraction: 0, marginFraction: 0, openPositions: 0, heldSide: null, availableEquity: 0 };
    }
    const credentials = await apiCredentialsService.getCredentials(userId, 'poloniex');
    if (!credentials) {
      return { equityFraction: 0, marginFraction: 0, openPositions: 0, heldSide: null, availableEquity: 0 };
    }
    const [bal, positions] = await Promise.all([
      poloniexFuturesService.getAccountBalance(credentials),
      poloniexFuturesService.getPositions(credentials),
    ]);
    const equity = Number(bal?.totalBalance ?? bal?.eq ?? 0);
    const equityFraction = equity > 0 ? Math.min(1, equity / 27.15) : 0;
    const marginFraction = equity > 0 ? Math.min(1, Math.max(0, (equity - Number(bal?.availableBalance ?? 0)) / equity)) : 0;
    const positionsList = Array.isArray(positions) ? positions : [];
    const forSymbol = positionsList.find((p: Record<string, unknown>) =>
      String(p.symbol ?? '') === symbol && Math.abs(Number(p.qty ?? p.size ?? 0)) > 0);
    // Side resolution: posSide-first, qty-sign fallback (shared helper).
    // The prior "sign of qty is authoritative" assumption was wrong for
    // HEDGE accounts — qty is a POSITIVE magnitude there and the side
    // lives in posSide. It misread every HEDGE short as a long, so when
    // a position was reversed long→short on the exchange the kernel
    // stayed stuck on `held long`, could not DCA, and was paralysed
    // (2026-05-14 incident).
    const heldSide: 'long' | 'short' | null = forSymbol
      ? resolveExchangePositionSide(forSymbol as Record<string, unknown>)
      : null;
    return {
      equityFraction,
      marginFraction,
      openPositions: positionsList.length,
      heldSide,
      availableEquity: Number(bal?.availableBalance ?? bal?.availMgn ?? equity),
    };
  } catch (err) {
    logger.debug('[Monkey] fetchAccountContext failed (fail-soft)', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { equityFraction: 0, marginFraction: 0, openPositions: 0, heldSide: null, availableEquity: 0 };
  }
}
