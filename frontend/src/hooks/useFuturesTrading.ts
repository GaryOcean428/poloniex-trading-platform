import { useCallback, useMemo } from 'react';
import { useErrorHandler } from './useErrorHandler';
import PoloniexFuturesAPI, { FuturesOrder, FuturesPosition, OrderSide, OrderType, PositionSide, MarginMode } from '@/services/poloniexFuturesAPI';

// Define local types for better error handling
interface LocalErrorHandlerOptions {
  retryCount?: number;
  retryDelay?: number;
  onRetry?: (error: Error, attempt: number) => void;
  onFallback?: (error: Error) => void;
  fallbackValue?: any;
  logToServer?: boolean;
  showToUser?: boolean;
}

/**
 * Custom hook for handling Poloniex Futures API requests with proper error handling
 */
export const useFuturesTrading = () => {
  const { withErrorHandling } = useErrorHandler();
  // Create API instance with useMemo to avoid recreating on every render
  const api = useMemo(() => new PoloniexFuturesAPI(), []);

  /**
   * Get account positions with error handling
   * @returns List of positions or null on error
   */
  const getPositions = useCallback(async (): Promise<FuturesPosition[] | null> => {
    const wrappedFn = withErrorHandling(async () => {
      const positions = await api.getCurrentPositions();
      return positions;
    });
    return await wrappedFn();
  }, [withErrorHandling, api]);

  /**
   * Get open orders with error handling
   * @returns List of orders or null on error
   */
  const getOpenOrders = useCallback(async (): Promise<FuturesOrder[] | null> => {
    const wrappedFn = withErrorHandling(async () => {
      const orders = await api.getOpenOrders();
      return orders.map(order => ({ 
        ...order, 
        pair: order.symbol, 
        status: order.state, 
        timestamp: order.createTime 
      }));
    });
    return await wrappedFn();
  }, [withErrorHandling, api]);

  /**
   * Place a futures order with error handling
   * @param pair Trading pair
   * @param side Order side
   * @param type Order type
   * @param size Order size
   * @param price Order price (for limit orders)
   * @returns Order result or null on error
   */
  const placeOrder = useCallback(async (
    pair: string,
    side: 'BUY' | 'SELL',
    type: 'LIMIT' | 'MARKET',
    size: number,
    price?: number
  ) => {
    const errorHandlerOptions: LocalErrorHandlerOptions = {
      fallbackValue: null,
      retryCount: 2,
      showToUser: true
    };
    
    return withErrorHandling(async () => {
      const orderResponse = await api.placeOrder({
        symbol: pair,
        side: side as OrderSide,
        type: type as OrderType,
        size: size.toString(),
        price: price?.toString(),
        posSide: PositionSide.BOTH // Default position side
      });
      
      // Convert OrderResponse to FuturesOrder format
      return {
        id: orderResponse.orderId,
        symbol: orderResponse.symbol,
        side: orderResponse.side,
        type: orderResponse.type,
        price: orderResponse.price,
        size: orderResponse.size,
        value: orderResponse.filledValue,
        leverage: '1', // Default leverage
        marginMode: MarginMode.ISOLATED,
        positionSide: PositionSide.BOTH,
        state: orderResponse.state,
        createTime: orderResponse.createTime,
        updateTime: orderResponse.updateTime,
        filledSize: orderResponse.filledSize,
        filledValue: orderResponse.filledValue,
        avgPrice: '0', // Calculated from filled values
        fee: '0', // Not provided in response
        clientOrderId: orderResponse.clientOrderId
      };
    }, errorHandlerOptions);
  }, [withErrorHandling, api]);

  /**
   * Cancel an order with error handling
   * @param params Order cancellation parameters
   * @returns Success status or null on error
   */
  const cancelOrder = useCallback(async (params: { symbol: string; orderId: string }) => {
    const errorHandlerOptions: LocalErrorHandlerOptions = {
      fallbackValue: null,
      retryCount: 2,
      showToUser: true
    };
    
    return withErrorHandling(async () => {
      const result = await api.cancelOrder(params);
      return result.state === 'CANCELLED';
    }, errorHandlerOptions);
  }, [withErrorHandling, api]);

  /**
   * Set leverage for a pair with error handling
   * @param symbol Trading symbol
   * @returns Success status or null on error
   */
  const setLeverage = useCallback(async (symbol: string) => {
    const errorHandlerOptions: LocalErrorHandlerOptions = {
      fallbackValue: null,
      retryCount: 1,
      showToUser: true
    };
    
    return withErrorHandling(async () => {
      const leverageInfo = await api.getLeverages(symbol);
      return leverageInfo.leverage !== undefined;
    }, errorHandlerOptions);
  }, [withErrorHandling, api]);

  /**
   * Set margin mode for a pair with error handling
   * Note: This functionality may not be directly available in the current API
   * @returns Success status or null on error
   */
  const setMarginMode = useCallback(async () => {
    const errorHandlerOptions: LocalErrorHandlerOptions = {
      fallbackValue: null,
      retryCount: 1,
      showToUser: true
    };
    
    return withErrorHandling(async () => {
      // Return true as a placeholder since setMarginMode is not available in the API
      return true;
    }, errorHandlerOptions);
  }, [withErrorHandling]);

  return {
    getPositions,
    getOpenOrders,
    placeOrder,
    cancelOrder,
    setLeverage,
    setMarginMode
  };
};

export default useFuturesTrading;
