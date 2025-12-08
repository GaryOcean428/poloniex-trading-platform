/**
 * Poloniex Futures V3 Markets Catalog Types
 * Shared, strict types to load/serve the normalized markets catalog JSON.
 */

export interface RiskTier {
  tier: number | null;
  maxPosition: number | null;
  initialMarginRate: number | null;
  maintenanceMarginRate: number | null;
}

export interface MaintenanceMarginRow {
  notionalFloor: number;
  maintenanceMarginRate: number;
}

export interface FeesBps {
  maker: number | null;
  taker: number | null;
}

export interface FundingInfo {
  intervalHours: number;
  rateCap: number | null;
}

export type ContractType = 'perpetual' | 'delivery' | 'other';
export type MarketStatus = 'trading' | 'paused' | 'delisted';

export interface MarketEntry {
  symbol: string; // e.g., BTCUSDT
  base: string;   // e.g., BTC
  quote: string;  // e.g., USDT
  contractType: ContractType;
  status: MarketStatus;
  pricePrecision: number | null;
  quantityPrecision: number | null;
  tickSize: number | null;
  lotSize: number | null;
  minNotional: number | null;
  maxLeverage: number | null;
  maintenanceMarginTable: MaintenanceMarginRow[];
  riskLimits: RiskTier[];
  feesBps: FeesBps;
  funding: FundingInfo;
}

export interface MarketCatalog {
  $schema?: string;
  _note?: string;
  version: number;
  source: string;
  lastSynced: string;
  markets: MarketEntry[];
}

export interface SymbolQuery {
  symbol?: string;
}

/**
 * Utility: normalize UI symbols like "BTC-USDT" to "BTCUSDT"
 */
export function normalizeFuturesSymbol(sym?: string): string | undefined {
  if (!sym) return sym;
  return sym.replace(/-/g, '').toUpperCase();
}
