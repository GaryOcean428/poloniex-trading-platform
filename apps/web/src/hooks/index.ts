/**
 * Hooks barrel file - centralized exports for all custom React hooks
 */

// Hooks with named exports only (no default export)
export { useAccessibility, useKeyboardNavigation, useLiveRegion } from './useAccessibility';
export { useAuth } from './useAuth';
export { useDateFormatter } from './useDateFormatter';
export { useErrorRecovery } from './useErrorRecovery';
export { useFutures } from './useFutures';
export { useMarketCatalog, useMarketSymbols, useMarket, MARKETS_KEYS } from './useMarkets';
export { useMockMode } from './useMockMode';
export { usePageVisibility } from './usePageVisibility';
export { usePersistedState } from './usePersistedState';
export { usePoloniexData } from './usePoloniexData';
export { useResponsiveNav, useBreakpoint } from './useResponsiveNav';
export { useSettings } from './useSettings';
export { useTradingContext } from './useTradingContext';
export { useWebSocket } from './useWebSocket';

// Hooks with both named and default exports
export { default as useAPICall } from './useAPICall';
export { default as useApiRequest } from './useApiRequest';
export { default as useErrorHandler } from './useErrorHandler';
export { default as useFuturesTrading } from './useFuturesTrading';
