import { randomUUID } from 'crypto';

import { query } from '../db/connection.js';

export interface PaperPlaceOrderInput {
  engine: 'monkey' | 'live_signal';
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  leverage: number;
  markPrice: number;
  metadata?: Record<string, unknown>;
}

export interface PaperPlaceOrderResult {
  orderId: string;
  filled: true;
  fillPrice: number;
  slippageBps: number;
}

export interface PaperPosition {
  id: string;
  orderId: string;
  engine: 'monkey' | 'live_signal';
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number | null;
  entryTime: Date;
  metadata: Record<string, unknown> | null;
}

export function calculateSlippageBps(leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return Math.min(10, leverage / 10);
}

function applyEntrySlippage(markPrice: number, side: 'long' | 'short', slippageBps: number): number {
  const slip = markPrice * (slippageBps / 10_000);
  return side === 'long' ? markPrice + slip : markPrice - slip;
}

function applyExitSlippage(exitPrice: number, side: 'long' | 'short', slippageBps: number): number {
  const slip = exitPrice * (slippageBps / 10_000);
  return side === 'long' ? exitPrice - slip : exitPrice + slip;
}

function assertFinitePositivePrice(label: string, price: number): void {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`paper_mode_invalid_mark_price: ${label} must be finite and > 0`);
  }
}

function toTableMissingError(err: unknown): never {
  const pgErr = err as { code?: string; message?: string };
  if (pgErr?.code === '42P01' || String(pgErr?.message ?? '').includes('paper_trades')) {
    throw new Error('paper_mode_misconfigured: paper_trades table missing (run migration 049_paper_trades.sql)');
  }
  throw err;
}

export async function paperPlaceOrder(input: PaperPlaceOrderInput): Promise<PaperPlaceOrderResult> {
  assertFinitePositivePrice('markPrice', input.markPrice);
  const slippageBps = calculateSlippageBps(input.leverage);
  const fillPrice = applyEntrySlippage(input.markPrice, input.side, slippageBps);
  const orderId = `paper-${randomUUID()}`;

  try {
    await query(
      `INSERT INTO paper_trades
         (engine, user_id, symbol, side, entry_price, quantity, leverage, slippage_bps, order_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        input.engine,
        input.userId,
        input.symbol,
        input.side,
        fillPrice,
        input.quantity,
        input.leverage,
        slippageBps,
        orderId,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  } catch (err) {
    toTableMissingError(err);
  }

  return {
    orderId,
    filled: true,
    fillPrice,
    slippageBps,
  };
}

export async function paperClosePosition(
  orderId: string,
  exitPrice: number,
  exitReason: string,
): Promise<{ pnl: number; pnlPercentage: number }> {
  assertFinitePositivePrice('exitPrice', exitPrice);
  try {
    const existing = await query(
      `SELECT id, side, entry_price, quantity, leverage, slippage_bps
         FROM paper_trades
        WHERE order_id = $1
          AND exit_time IS NULL
        LIMIT 1`,
      [orderId],
    );
    const row = existing.rows[0] as unknown as {
      id: string;
      side: 'long' | 'short';
      entry_price: string;
      quantity: string;
      leverage: number | null;
      slippage_bps: string | number | null;
    } | undefined;
    if (!row) {
      throw new Error(`paper_order_not_open: ${orderId}`);
    }

    const side = row.side === 'short' ? 'short' : 'long';
    const entry = Number(row.entry_price);
    const qty = Math.abs(Number(row.quantity));
    const leverage = Number(row.leverage ?? 0);
    const slippageBps = Number(row.slippage_bps ?? 0);
    const slippedExitPrice = applyExitSlippage(exitPrice, side, slippageBps);
    const pnl = side === 'long'
      ? (slippedExitPrice - entry) * qty
      : (entry - slippedExitPrice) * qty;
    const margin = leverage > 0 ? (entry * qty) / leverage : entry * qty;
    const pnlPercentage = margin > 0 ? (pnl / margin) * 100 : 0;

    await query(
      `UPDATE paper_trades
          SET exit_price = $2,
              exit_time = NOW(),
              exit_reason = $3,
              pnl = $4,
              pnl_percentage = $5
        WHERE id = $1`,
      [row.id, slippedExitPrice, exitReason, pnl, pnlPercentage],
    );

    return { pnl, pnlPercentage };
  } catch (err) {
    toTableMissingError(err);
  }
}

export async function getPaperOpenPositions(
  engine: 'monkey' | 'live_signal',
  userId: string,
): Promise<PaperPosition[]> {
  try {
    const result = await query(
      `SELECT id, order_id, engine, user_id, symbol, side, entry_price, quantity, leverage, entry_time, metadata
         FROM paper_trades
        WHERE engine = $1
          AND user_id = $2
          AND exit_time IS NULL
        ORDER BY entry_time ASC`,
      [engine, userId],
    );
    return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      engine: String(row.engine) as 'monkey' | 'live_signal',
      userId: String(row.user_id),
      symbol: String(row.symbol),
      side: String(row.side) === 'short' ? 'short' : 'long',
      entryPrice: Number(row.entry_price),
      quantity: Number(row.quantity),
      leverage: row.leverage === null ? null : Number(row.leverage),
      entryTime: new Date(String(row.entry_time)),
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }));
  } catch (err) {
    toTableMissingError(err);
  }
}
