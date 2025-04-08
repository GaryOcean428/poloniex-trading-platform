import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, SelectOption } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useFutures } from '@/context/FuturesContext';
import { MarginMode, OrderSide, OrderType, PositionSide } from '@/services/poloniexFuturesAPI';

interface FuturesTradingPanelProps {
  symbol: string;
}

const FuturesTradingPanel: React.FC<FuturesTradingPanelProps> = ({ symbol }) => {
  const { 
    api, 
    positions, 
    accountBalance, 
    positionMode, 
    isLoading, 
    error,
    refreshPositions,
    setLeverage
  } = useFutures();

  // Trading form state
  const [orderSide, setOrderSide] = useState<OrderSide>(OrderSide.BUY);
  const [orderType, setOrderType] = useState<OrderType>(OrderType.LIMIT);
  const [positionSide, setPositionSide] = useState<PositionSide>(PositionSide.LONG);
  const [price, setPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [leverage, setLeverage] = useState<string>('10');
  const [marginMode, setMarginMode] = useState<MarginMode>(MarginMode.CROSS);
  const [isReduceOnly, setIsReduceOnly] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Get current position for this symbol
  const currentPosition = positions.find(pos => pos.symbol === symbol);

  // Calculate max quantity based on account balance and leverage
  const calculateMaxQuantity = (): string => {
    if (!accountBalance || !price) return '0';
    
    const availableBalance = parseFloat(accountBalance.eq);
    const currentPrice = parseFloat(price);
    const currentLeverage = parseFloat(leverage);
    
    if (isNaN(availableBalance) || isNaN(currentPrice) || isNaN(currentLeverage) || currentPrice === 0) {
      return '0';
    }
    
    // Max quantity = (Available Balance * Leverage) / Price
    const maxQty = (availableBalance * currentLeverage) / currentPrice;
    return maxQty.toFixed(8);
  };

  // Handle leverage change
  const handleLeverageChange = async (newLeverage: string) => {
    setLeverage(newLeverage);
    
    try {
      await setLeverage(symbol, newLeverage, marginMode);
    } catch (err) {
      console.error('Failed to set leverage:', err);
    }
  };

  // Handle order submission
  const handleSubmitOrder = async () => {
    if (!symbol || !quantity || (orderType === OrderType.LIMIT && !price)) {
      setOrderError('Please fill all required fields');
      return;
    }
    
    setIsSubmitting(true);
    setOrderError(null);
    
    try {
      await api.placeOrder({
        symbol,
        side: orderSide,
        type: orderType,
        price: orderType === OrderType.LIMIT ? price : undefined,
        size: quantity,
        posSide: positionSide
      });
      
      // Reset form after successful order
      setQuantity('');
      if (orderType === OrderType.LIMIT) {
        setPrice('');
      }
      
      // Refresh positions to show the new position
      await refreshPositions();
    } catch (err) {
      console.error('Failed to place order:', err);
      setOrderError(err instanceof Error ? err.message : 'Failed to place order');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle close position
  const handleClosePosition = async () => {
    if (!currentPosition) return;
    
    setIsSubmitting(true);
    setOrderError(null);
    
    try {
      // To close a position, place an order in the opposite direction with the same size
      const closeSide = currentPosition.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
      
      await api.placeOrder({
        symbol,
        side: closeSide,
        type: OrderType.MARKET,
        size: currentPosition.qty,
        posSide: currentPosition.posSide as PositionSide
      });
      
      // Refresh positions to show the closed position
      await refreshPositions();
    } catch (err) {
      console.error('Failed to close position:', err);
      setOrderError(err instanceof Error ? err.message : 'Failed to close position');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Trading Form */}
      <Card>
        <CardHeader>
          <CardTitle>Futures Trading</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Order Type */}
            <div>
              <label className="block text-sm font-medium mb-1">Order Type</label>
              <Select 
                value={orderType} 
                onChange={(e) => setOrderType(e.target.value as OrderType)}
                className="w-full"
              >
                <SelectOption value={OrderType.LIMIT}>Limit</SelectOption>
                <SelectOption value={OrderType.MARKET}>Market</SelectOption>
                <SelectOption value={OrderType.POST_ONLY}>Post Only</SelectOption>
              </Select>
            </div>
            
            {/* Order Side */}
            <div>
              <label className="block text-sm font-medium mb-1">Side</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className={`w-full ${orderSide === OrderSide.BUY ? 'bg-green-600' : 'bg-gray-200 text-gray-800'}`}
                  onClick={() => setOrderSide(OrderSide.BUY)}
                >
                  Buy/Long
                </Button>
                <Button
                  type="button"
                  className={`w-full ${orderSide === OrderSide.SELL ? 'bg-red-600' : 'bg-gray-200 text-gray-800'}`}
                  onClick={() => setOrderSide(OrderSide.SELL)}
                >
                  Sell/Short
                </Button>
              </div>
            </div>
            
            {/* Position Side (only visible in Hedge mode) */}
            {positionMode === 'HEDGE' && (
              <div>
                <label className="block text-sm font-medium mb-1">Position Side</label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className={`w-full ${positionSide === PositionSide.LONG ? 'bg-blue-600' : 'bg-gray-200 text-gray-800'}`}
                    onClick={() => setPositionSide(PositionSide.LONG)}
                  >
                    Long
                  </Button>
                  <Button
                    type="button"
                    className={`w-full ${positionSide === PositionSide.SHORT ? 'bg-blue-600' : 'bg-gray-200 text-gray-800'}`}
                    onClick={() => setPositionSide(PositionSide.SHORT)}
                  >
                    Short
                  </Button>
                </div>
              </div>
            )}
            
            {/* Price (only for Limit orders) */}
            {orderType !== OrderType.MARKET && (
              <div>
                <label className="block text-sm font-medium mb-1">Price</label>
                <Input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Enter price"
                  min="0"
                  step="0.01"
                />
              </div>
            )}
            
            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Enter quantity"
                min="0"
                step="0.001"
              />
              <div className="flex justify-between mt-1">
                <button 
                  className="text-xs text-blue-600"
                  onClick={() => setQuantity((parseFloat(calculateMaxQuantity()) * 0.25).toFixed(8))}
                >
                  25%
                </button>
                <button 
                  className="text-xs text-blue-600"
                  onClick={() => setQuantity((parseFloat(calculateMaxQuantity()) * 0.5).toFixed(8))}
                >
                  50%
                </button>
                <button 
                  className="text-xs text-blue-600"
                  onClick={() => setQuantity((parseFloat(calculateMaxQuantity()) * 0.75).toFixed(8))}
                >
                  75%
                </button>
                <button 
                  className="text-xs text-blue-600"
                  onClick={() => setQuantity(calculateMaxQuantity())}
                >
                  Max
                </button>
              </div>
            </div>
            
            {/* Leverage */}
            <div>
              <label className="block text-sm font-medium mb-1">Leverage: {leverage}x</label>
              <input
                type="range"
                min="1"
                max="75"
                value={leverage}
                onChange={(e) => handleLeverageChange(e.target.value)}
                className="w-full"
              />
              <div className="flex justify-between text-xs">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>75x</span>
              </div>
            </div>
            
            {/* Margin Mode */}
            <div>
              <label className="block text-sm font-medium mb-1">Margin Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className={`w-full ${marginMode === MarginMode.CROSS ? 'bg-blue-600' : 'bg-gray-200 text-gray-800'}`}
                  onClick={() => setMarginMode(MarginMode.CROSS)}
                >
                  Cross
                </Button>
                <Button
                  type="button"
                  className={`w-full ${marginMode === MarginMode.ISOLATED ? 'bg-blue-600' : 'bg-gray-200 text-gray-800'}`}
                  onClick={() => setMarginMode(MarginMode.ISOLATED)}
                >
                  Isolated
                </Button>
              </div>
            </div>
            
            {/* Reduce Only */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Reduce Only</label>
              <Switch
                checked={isReduceOnly}
                onCheckedChange={setIsReduceOnly}
              />
            </div>
            
            {/* Error message */}
            {orderError && (
              <div className="text-red-500 text-sm mt-2">{orderError}</div>
            )}
            
            {/* Submit Button */}
            <Button
              type="button"
              className={`w-full ${orderSide === OrderSide.BUY ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              onClick={handleSubmitOrder}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : `${orderSide === OrderSide.BUY ? 'Buy/Long' : 'Sell/Short'} ${symbol}`}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Position Information */}
      <Card>
        <CardHeader>
          <CardTitle>Current Position</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4">Loading position data...</div>
          ) : error ? (
            <div className="text-red-500 text-center py-4">{error}</div>
          ) : currentPosition ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-500">Side</span>
                  <p className={`font-medium ${currentPosition.side === OrderSide.BUY ? 'text-green-600' : 'text-red-600'}`}>
                    {currentPosition.side === OrderSide.BUY ? 'Long' : 'Short'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Size</span>
                  <p className="font-medium">{currentPosition.qty}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Entry Price</span>
                  <p className="font-medium">{currentPosition.openAvgPx}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Mark Price</span>
                  <p className="font-medium">{currentPosition.markPx}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Liquidation Price</span>
                  <p className="font-medium">{currentPosition.liqPx}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Margin Mode</span>
                  <p className="font-medium">{currentPosition.mgnMode}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Leverage</span>
                  <p className="font-medium">{currentPosition.lever}x</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Margin</span>
                  <p className="font-medium">{currentPosition.mgn}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">PnL</span>
                  <p className={`font-medium ${parseFloat(currentPosition.pnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {currentPosition.pnl} ({parseFloat(currentPosition.uplRatio) * 100}%)
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">ADL</span>
                  <p className="font-medium">{currentPosition.adl}</p>
                </div>
              </div>
              
              <Button
                type="button"
                className="w-full bg-yellow-600 hover:bg-yellow-700"
                onClick={handleClosePosition}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Closing...' : 'Close Position'}
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">No open position for {symbol}</div>
          )}
          
          {/* Account Balance Summary */}
          {accountBalance && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <h3 className="font-medium mb-2">Account Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-500">Equity</span>
                  <p className="font-medium">{accountBalance.eq}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Available</span>
                  <p className="font-medium">
                    {(parseFloat(accountBalance.eq) - parseFloat(accountBalance.im)).toFixed(2)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Initial Margin</span>
                  <p className="font-medium">{accountBalance.im}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Maintenance Margin</span>
                  <p className="font-medium">{accountBalance.mm}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FuturesTradingPanel;
