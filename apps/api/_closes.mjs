// Read-only realized-PnL investigator: aggregates /v3/account/bills PNL +
// FUNDING_FEE over a window into per-close-cluster outcomes. No writes.
import axios from 'axios';
import crypto from 'crypto';
const KEY = process.env.POLONIEX_API_KEY, SECRET = process.env.POLONIEX_API_SECRET;
if (!KEY || !SECRET) { console.error('MISSING_CREDS'); process.exit(1); }
const BASE = 'https://api.poloniex.com';
const HOURS = Number(process.argv[2] || 4);
function sign(m, rp, p, ts) {
  let s; if (p && Object.keys(p).length) { const a = { ...p, signTimestamp: ts }; s = Object.keys(a).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(a[k])}`).join('&'); } else s = `signTimestamp=${ts}`;
  return crypto.createHmac('sha256', SECRET).update(`${m.toUpperCase()}\n${rp}\n${s}`).digest('base64');
}
async function get(endpoint, params = {}) {
  const ts = Date.now().toString(), rp = `/v3${endpoint}`;
  const h = { 'Content-Type': 'application/json', key: KEY, signature: sign('GET', rp, params, ts), signTimestamp: ts, signatureMethod: 'hmacSHA256', signatureVersion: '2' };
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return (await axios({ method: 'get', url: BASE + rp + qs, headers: h, timeout: 30000 })).data;
}
const rowsOf = (d) => Array.isArray(d?.data) ? d.data : [];
async function run() {
  const since = Date.now() - HOURS * 3600 * 1000;
  let cursor = null, all = [];
  for (let p = 0; p < 12; p++) {
    const d = await get('/account/bills', { limit: 100, ...(cursor ? { from: cursor } : {}) });
    const rows = rowsOf(d);
    if (!rows.length) break;
    all.push(...rows);
    cursor = String(rows[rows.length - 1]?.id ?? '') || null;
    if (rows.every(r => Number(r.cTime) < since)) break;
    if (!cursor) break;
  }
  const pnl = all.filter(r => r.type === 'PNL' && Number(r.cTime) >= since);
  const fund = all.filter(r => r.type === 'FUNDING_FEE' && Number(r.cTime) >= since);
  // cluster PNL rows by (symbol, posSide, cTime) — a close event shares cTime
  const clusters = {};
  for (const r of pnl) {
    const k = `${r.symbol}|${r.posSide}|${r.cTime}`;
    clusters[k] = clusters[k] || { symbol: r.symbol, posSide: r.posSide, cTime: Number(r.cTime), sum: 0, n: 0 };
    clusters[k].sum += Number(r.sz); clusters[k].n++;
  }
  const cl = Object.values(clusters).sort((a, b) => b.cTime - a.cTime);
  let net = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0;
  for (const c of cl) { net += c.sum; if (c.sum > 0) { wins++; winSum += c.sum; } else if (c.sum < 0) { losses++; lossSum += c.sum; } }
  const fundNet = fund.reduce((s, r) => s + Number(r.sz), 0);
  console.log(JSON.stringify({
    windowHours: HOURS, closeEvents: cl.length, wins, losses,
    winRate: cl.length ? Number((wins / (wins + losses) * 100).toFixed(1)) : null,
    grossRealized: Number(net.toFixed(4)), winSum: Number(winSum.toFixed(4)), lossSum: Number(lossSum.toFixed(4)),
    fundingNet: Number(fundNet.toFixed(4)), netWithFunding: Number((net + fundNet).toFixed(4)),
    recentCloses: cl.slice(0, 14).map(c => ({ t: new Date(c.cTime).toISOString().slice(11, 19), sym: c.symbol.split('_')[0], side: c.posSide, pnl: Number(c.sum.toFixed(4)), fills: c.n })),
  }, null, 2));
}
run().then(() => process.exit(0)).catch(e => { console.error('ERR', e?.response?.status, JSON.stringify(e?.response?.data || e.message)); process.exit(1); });
