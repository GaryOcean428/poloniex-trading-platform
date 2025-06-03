import { useCallback } from 'react';
import { useErrorHandler } from './useErrorHandler';
import { FuturesOrder, Position } from '@/types';

/**
 * Custom hook for handling Poloniex Futures API requests with proper error handling
 */
export const useFuturesTrading = () => {
  const { withErrorHandling } = useErrorHandler();
  // Import the default export directly
  const api = new (require('@/services/poloniexFuturesAPI').default)();

  /**
   * Get account positions with error handling
   * @returns List of positions or null on error
   */
  const getPositions = useCallback(async (): Promise<Position[] | null> => {
    const wrappedFn = withErrorHandling(async () => {
      const positions = await api.getPositions();
      return positions;
    });
    return await wrappedFn();
  }, [withErrorHandling]);

  /**
   * Get open orders with error handling
   * @returns List of orders or null on error
   */
  const getOpenOrders = useCallback(async (): Promise<FuturesOrder[] | null> => {
    const wrappedFn = withErrorHandling(async () => {
      const orders = await api.getOpenOrders();
      return orders;
    });
    return await wrappedFn();
  }, [withErrorHandling]);

  /**
   * Place a futures order with error handling
   * @param order Order details
   * @returns Order result or null on error
   */
  const placeOrder = useCallback(async (
    pair: string,
    side: 'BUY' | 'SELL',
    type: 'LIMIT' | 'MARKET',
    size: number,
    price?: number,
    leverage?: number,
    marginMode?: 'ISOLATED' | 'CROSS'
  ): Promise<FuturesOrder | null> => {
    return withErrorHandling(async () => {
      const order = await api.placeOrder(pair, side, type, size, price, leverage, marginMode);
      return order;
    }, 'Failed to place order');
  }, [withErrorHandling]);

  /**
   * Cancel an order with error handling
   * @param orderId Order ID to cancel
   * @returns Success status or null on error
   */
  const cancelOrder = useCallback(async (orderId: string): Promise<boolean | null> => {
    return withErrorHandling(async () => {
      const result = await api.cancelOrder(orderId);
      return result;
    }, 'Failed to cancel order');
  }, [withErrorHandling]);

  /**
   * Set leverage for a pair with error handling
   * @param pair Trading pair
   * @param leverage Leverage value
   * @returns Success status or null on error
   */
  const setLeverage = useCallback(async (pair: string, leverage: number): Promise<boolean | null> => {
    return withErrorHandling(async () => {
      const result = await api.setLeverage(pair, leverage);
      return result;
    }, 'Failed to set leverage');
  }, [withErrorHandling]);

  /**
   * Set margin mode for a pair with error handling
   * @param pair Trading pair
   * @param marginMode Margin mode (ISOLATED or CROSS)
   * @returns Success status or null on error
   */
  const setMarginMode = useCallback(async (
    pair: string, 
    marginMode: 'ISOLATED' | 'CROSS'
  ): Promise<boolean | null> => {
    return withErrorHandling(async () => {
      const result = await api.setMarginMode(pair, marginMode);
      return result;
    }, 'Failed to set margin mode');
  }, [withErrorHandling]);

  return {
    getPositions,
    getOpenOrders,
    placeOrder,
    cancelOrder,
    setLeverage,
    setMarginMode,
    errors,
    isLoading,
    addError,
    clearErrors
  };
};

export default useFuturesTrading;
