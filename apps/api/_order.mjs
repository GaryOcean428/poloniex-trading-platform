// REAL order placer for the CC race (operator-authorized live trading on the
// shared polytrade-be account, isolated margin). Args:
//   node _order.mjs <SYMBOL> <SELL|BUY> <LONG|SHORT> <ISOLATED|CROSS> <sz> <clOrdId>
// Prints the raw API response. MARKET orders only. No stop/target here — CC
// manages exits by monitoring (1:8 discipline).
import axios from 'axios';
import crypto from 'crypto';
const KEY = process.env.POLONIEX_API_KEY, SECRET = process.env.POLONIEX_API_SECRET;
if (!KEY || !SECRET) { console.error('MISSING_CREDS'); process.exit(1); }
const [, , SYMBOL, SIDE, POSSIDE, MGN, SZ, CLORD] = process.argv;
if (!SYMBOL || !SIDE || !POSSIDE || !MGN || !SZ) {
  console.error('usage: _order.mjs SYMBOL SELL|BUY LONG|SHORT ISOLATED|CROSS sz [clOrdId]');
  process.exit(1);
}
const BASE = 'https://api.poloniex.com';
function signPost(requestPath, bodyJson, ts) {
  const paramString = `requestBody=${bodyJson}&signTimestamp=${ts}`;
  return crypto.createHmac('sha256', SECRET).update(`POST\n${requestPath}\n${paramString}`).digest('base64');
}
async function run() {
  const ts = Date.now().toString();
  const rp = '/v3/trade/order';
  const body = {
    symbol: SYMBOL, side: SIDE, mgnMode: MGN, posSide: POSSIDE,
    type: 'MARKET', sz: SZ,
    ...(CLORD ? { clOrdId: CLORD } : {}),
  };
  const bodyJson = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json', key: KEY, signature: signPost(rp, bodyJson, ts),
    signTimestamp: ts, signatureMethod: 'hmacSHA256', signatureVersion: '2',
  };
  console.log('PLACING:', bodyJson);
  try {
    const resp = await axios({ method: 'post', url: BASE + rp, headers, data: body, timeout: 30000 });
    console.log('RESPONSE:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('ERROR', e?.response?.status, JSON.stringify(e?.response?.data || e.message));
  }
}
run().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1); });
