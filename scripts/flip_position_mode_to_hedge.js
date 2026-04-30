/**
 * flip_position_mode_to_hedge.js — one-shot operational script for
 * flipping the live Poloniex futures account from ONE_WAY to HEDGE
 * position-direction mode.
 *
 * Why
 * ───
 * Proposal #10 (PR #610) introduced lane-isolated positions: a swing-
 * long and a scalp-short can coexist on the same symbol as two
 * independent positions. This requires Poloniex's HEDGE mode (LONG +
 * SHORT books per symbol) instead of ONE_WAY (single net position).
 * The PR shipped the kernel-side machinery (lane param envelope,
 * per-lane SymbolState dicts, posSide-on-HEDGE order plumbing) and
 * deferred the actual exchange flip until positions closed.
 *
 * As of 2026-04-30 the live account is FLAT — no open K positions —
 * so Poloniex's "no positions open" precondition for the flip is
 * satisfied. The user has authorized the flip; this script is the
 * idempotent one-shot to do it.
 *
 * What it does
 * ────────────
 * 1. Loads POLONIEX_API_KEY + POLONIEX_API_SECRET from the
 *    environment (Railway production shell or local .env).
 * 2. Reads the current posMode via GET /v3/position/mode.
 * 3. If already HEDGE, logs and exits 0 (idempotent).
 * 4. Otherwise calls POST /v3/position/mode body { posMode: 'HEDGE' }.
 * 5. Re-reads the mode to verify the flip stuck.
 * 6. Logs every response body verbatim (no redaction beyond the API
 *    key prefix in step 1) for the runbook trail.
 *
 * Exit codes
 * ──────────
 *   0 = current mode HEDGE (either pre-existing or freshly set)
 *   1 = credentials missing
 *   2 = read-mode call failed
 *   3 = set-mode call failed (e.g. Poloniex rejected with positions
 *       still open, or 4xx auth)
 *   4 = post-flip verification disagreed with what we just set
 *
 * Run
 * ───
 *   Local with .env loaded (apps/api/.env or repo root .env):
 *     node scripts/flip_position_mode_to_hedge.js
 *
 *   Railway production (preferred — uses the actual live creds):
 *     railway run --service polytrade-be \
 *       node scripts/flip_position_mode_to_hedge.js
 *
 *   Or with explicit env vars:
 *     POLONIEX_API_KEY=xxx POLONIEX_API_SECRET=yyy \
 *       node scripts/flip_position_mode_to_hedge.js
 *
 * Note: the parent worktree must have built apps/api at least once so
 * dist/services/poloniexFuturesService.js exists. Railway builds it
 * automatically as part of the deploy step.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

// dotenv is best-effort: if running under Railway, env is already
// injected by the platform; we just want local dev to also work.
try {
  await import('dotenv/config');
} catch {
  /* optional — env vars already in process */
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadService() {
  // poloniexFuturesService is an ESM module; we resolve to a file URL
  // and dynamic-import it. Prefer the built dist (production parity)
  // and fall back to src (local dev) if dist is missing.
  const candidates = [
    path.resolve(__dirname, '..', 'apps', 'api', 'dist', 'services', 'poloniexFuturesService.js'),
    path.resolve(__dirname, '..', 'apps', 'api', 'src', 'services', 'poloniexFuturesService.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const mod = await import(pathToFileURL(p).href);
      return { mod, source: p };
    }
  }
  throw new Error(
    'poloniexFuturesService.js not found in apps/api/{dist,src}/services/. '
    + 'Run `yarn workspace @poloniex-platform/api build` first, or run this '
    + 'script from a built deployment (Railway production has dist baked in).',
  );
}

async function main() {
  const apiKey = process.env.POLONIEX_API_KEY || '';
  const apiSecret = process.env.POLONIEX_API_SECRET || '';
  if (!apiKey || !apiSecret) {
    console.error('[flip_position_mode_to_hedge] POLONIEX_API_KEY / POLONIEX_API_SECRET not set');
    console.error('  In Railway:  railway run --service polytrade-be node scripts/flip_position_mode_to_hedge.js');
    console.error('  Locally  :   put creds in apps/api/.env or export them in this shell');
    process.exit(1);
  }
  const credentials = { apiKey, apiSecret };
  console.log(`[flip_position_mode_to_hedge] credentials loaded (key prefix: ${apiKey.slice(0, 6)}...)`);

  const { mod, source } = await loadService();
  console.log(`[flip_position_mode_to_hedge] loaded service from ${source}`);
  const svc = mod.default;
  if (!svc || typeof svc.getPositionDirectionMode !== 'function'
      || typeof svc.setPositionDirectionMode !== 'function') {
    console.error('[flip_position_mode_to_hedge] service is missing getPositionDirectionMode / setPositionDirectionMode');
    console.error('  exports keys:', Object.keys(mod));
    process.exit(2);
  }

  // 1. Read current mode.
  let currentResp;
  try {
    currentResp = await svc.getPositionDirectionMode(credentials);
  } catch (err) {
    console.error('[flip_position_mode_to_hedge] read-mode call failed:', err && err.message);
    if (err && err.response) {
      console.error('  status:', err.response.status);
      console.error('  body  :', JSON.stringify(err.response.data || {}, null, 2));
    }
    process.exit(2);
  }
  console.log('[flip_position_mode_to_hedge] current mode response:', JSON.stringify(currentResp, null, 2));

  const currentMode =
    (currentResp && currentResp.data && currentResp.data.posMode)
    || (currentResp && currentResp.posMode)
    || null;
  console.log(`[flip_position_mode_to_hedge] resolved currentMode = ${currentMode}`);

  if (currentMode === 'HEDGE') {
    console.log('[flip_position_mode_to_hedge] account is already in HEDGE mode — nothing to do');
    process.exit(0);
  }

  // 2. Flip to HEDGE.
  let setResp;
  try {
    setResp = await svc.setPositionDirectionMode(credentials, 'HEDGE');
  } catch (err) {
    console.error('[flip_position_mode_to_hedge] set-mode call failed:', err && err.message);
    if (err && err.response) {
      console.error('  status:', err.response.status);
      console.error('  body  :', JSON.stringify(err.response.data || {}, null, 2));
      console.error('  hint  : Poloniex rejects mode changes when positions are open;');
      console.error('          confirm the account is FLAT before retrying.');
    }
    process.exit(3);
  }
  console.log('[flip_position_mode_to_hedge] set-mode response:', JSON.stringify(setResp, null, 2));

  // 3. Verify.
  let verifyResp;
  try {
    verifyResp = await svc.getPositionDirectionMode(credentials);
  } catch (err) {
    console.error('[flip_position_mode_to_hedge] post-flip read failed:', err && err.message);
    process.exit(4);
  }
  console.log('[flip_position_mode_to_hedge] verify response:', JSON.stringify(verifyResp, null, 2));
  const verifyMode =
    (verifyResp && verifyResp.data && verifyResp.data.posMode)
    || (verifyResp && verifyResp.posMode)
    || null;

  if (verifyMode === 'HEDGE') {
    console.log('[flip_position_mode_to_hedge] SUCCESS — account is now in HEDGE mode');
    process.exit(0);
  }

  console.error(`[flip_position_mode_to_hedge] FAILED — verify reports posMode=${verifyMode}, expected HEDGE`);
  process.exit(4);
}

main().catch((err) => {
  console.error('[flip_position_mode_to_hedge] uncaught error:', err);
  process.exit(5);
});
