// Read-only autonomous-monitor reader (#co-trade session). Prints equity,
// open positions, and is re-run each cycle via `railway run`. No writes.
import axios from 'axios';
import crypto from 'crypto';
const KEY = process.env.POLONIEX_API_KEY, SECRET = process.env.POLONIEX_API_SECRET;
if (!KEY || !SECRET) { console.error('MISSING_CREDS'); process.exit(1); }
const BASE = 'https://api.poloniex.com';
function sign(m, rp, params, ts) {
  let p; if (params && Object.keys(params).length) {
    const a = { ...params, signTimestamp: ts };
    p = Object.keys(a).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(a[k])}`).join('&');
  } else p = `signTimestamp=${ts}`;
  return crypto.createHmac('sha256', SECRET).update(`${m.toUpperCase()}\n${rp}\n${p}`).digest('base64');
}
async function get(endpoint, params = {}) {
  const ts = Date.now().toString(), rp = `/v3${endpoint}`;
  const h = { 'Content-Type': 'application/json', key: KEY, signature: sign('GET', rp, params, ts), signTimestamp: ts, signatureMethod: 'hmacSHA256', signatureVersion: '2' };
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return (await axios({ method: 'get', url: BASE + rp + qs, headers: h, timeout: 30000 })).data;
}
const rowsOf = (d) => Array.isArray(d?.data) ? d.data : (d?.data ? [d.data] : []);
async function run() {
  const bal = await get('/account/balance');
  const pos = await get('/trade/position/opens');
  const balRows = rowsOf(bal);
  // Sum USDT equity across account rows (eq / availEq / isolated).
  let equity = 0, avail = 0, details = [];
  for (const b of balRows) {
    const eq = parseFloat(b.eq ?? b.equity ?? b.totalEq ?? b.cashBal ?? '0');
    const av = parseFloat(b.availEq ?? b.availBal ?? b.avail ?? '0');
    if (Number.isFinite(eq)) equity += eq;
    if (Number.isFinite(av)) avail += av;
    details.push({ ccy: b.ccy, eq: b.eq, availEq: b.availEq, im: b.im, mm: b.mm, upl: b.upl });
  }
  const positions = rowsOf(pos).map(p => ({
    symbol: p.symbol, posSide: p.posSide, side: p.side, qty: p.qty ?? p.sz,
    openAvgPx: p.openAvgPx ?? p.avgPx, markPx: p.markPx, lever: p.lever,
    upl: p.upl ?? p.unrealizedPnl, uplRatio: p.uplRatio, mgnMode: p.mgnMode,
    liqPx: p.liqPx, im: p.im, mgnRatio: p.mgnRatio,
  }));
  const totalUpl = positions.reduce((s, p) => s + (parseFloat(p.upl ?? '0') || 0), 0);
  // ISOLATED positions segregate their margin OUT of the cross `eq` figure.
  // Total account value = cross equity + Σ isolated initial margin. Risk-guard
  // must use this, else allocating isolated margin reads as a phantom drawdown.
  const isolatedMargin = positions
    .filter((p) => String(p.mgnMode).toUpperCase() === 'ISOLATED')
    .reduce((s, p) => s + (parseFloat(p.im ?? '0') || 0), 0);
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    equityUSDT: Number(equity.toFixed(4)),
    isolatedMarginUSDT: Number(isolatedMargin.toFixed(4)),
    totalEquityUSDT: Number((equity + isolatedMargin).toFixed(4)),
    availUSDT: Number(avail.toFixed(4)),
    openPositions: positions.length,
    totalUnrealizedPnl: Number(totalUpl.toFixed(4)),
    positions,
    balanceDetail: details,
  }, null, 2));
}
run().then(() => process.exit(0)).catch(e => { console.error('ERR', e?.response?.status, JSON.stringify(e?.response?.data || e.message)); process.exit(1); });
