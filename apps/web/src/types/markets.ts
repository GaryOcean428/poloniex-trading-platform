export type ContractType = 'perpetual' | 'delivery' | 'other';
export type MarketStatus = 'trading' | 'paused' | 'delisted';

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

export interface MarketEntry {
  symbol: string;
  base: string;
  quote: string;
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

export const normalizeFuturesSymbol = (sym?: string): string | undefined => {
  if (!sym) return sym;
  return sym.replace(/-/g, '').toUpperCase();
};
