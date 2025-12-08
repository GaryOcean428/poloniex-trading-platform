import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import type { MarketCatalog, MarketEntry } from "@/types/markets";
import MarketsService from "@/services/MarketsService";

export const MARKETS_KEYS = {
  all: ["markets"] as const,
  catalog: () => [...MARKETS_KEYS.all, "catalog"] as const,
  symbols: () => [...MARKETS_KEYS.all, "symbols"] as const,
  entry: (symbol: string) => [...MARKETS_KEYS.all, "entry", symbol] as const,
};

export function useMarketCatalog(options?: UseQueryOptions<MarketCatalog, Error>) {
  return useQuery<MarketCatalog, Error>({
    queryKey: MARKETS_KEYS.catalog(),
    queryFn: () => MarketsService.fetchCatalog(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

export function useMarketSymbols(options?: UseQueryOptions<string[], Error>) {
  return useQuery<string[], Error>({
    queryKey: MARKETS_KEYS.symbols(),
    queryFn: () => MarketsService.fetchSymbols(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export function useMarket(
  symbol: string,
  options?: UseQueryOptions<MarketEntry, Error>
) {
  return useQuery<MarketEntry, Error>({
    queryKey: MARKETS_KEYS.entry(symbol),
    queryFn: () => MarketsService.getMarket(symbol),
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}
