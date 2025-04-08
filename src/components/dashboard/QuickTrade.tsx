import React, { useState } from 'react';
import { useTradingContext } from '../../context/TradingContext';

const QuickTrade: React.FC = () => {
  const { placeOrder, isLoading } = useTradingContext();
  const [pair, setPair] = useState('BTC-USDT');
  const [orderType, setOrderType] = useState('LIMIT');
  const [side, setSide] = useState('BUY');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  
  // In a real application, this would be fetched from an API
  const marketPrice = 51234.56;
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderStatus(null);
    
    try {
      // Place the order with the API
      const result = await placeOrder(
        pair,
        side.toLowerCase() as 'buy' | 'sell',
        orderType.toLowerCase() as 'limit' | 'market',
        parseFloat(amount),
        orderType === 'LIMIT' ? parseFloat(price) : undefined
      );
      
      console.log('Order placed:', result);
      setOrderStatus(`Order successfully placed: ${result.orderId || 'Success'}`);
      
      // Reset form
      setAmount('');
      setPrice('');
    } catch (error) {
      console.error('Failed to place order:', error);
      setOrderStatus(`Order failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Pair</label>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="mt-1 block w-full select"
            disabled={isLoading}
          >
            <option value="BTC-USDT">BTC-USDT</option>
            <option value="ETH-USDT">ETH-USDT</option>
            <option value="SOL-USDT">SOL-USDT</option>
          </select>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="mt-1 block w-full select"
              disabled={isLoading}
            >
              <option value="LIMIT">Limit</option>
              <option value="MARKET">Market</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Side</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`py-2 text-center rounded-md ${
                  side === 'BUY'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}
                onClick={() => setSide('BUY')}
                disabled={isLoading}
              >
                Buy
              </button>
              <button
                type="button"
                className={`py-2 text-center rounded-md ${
                  side === 'SELL'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}
                onClick={() => setSide('SELL')}
                disabled={isLoading}
              >
                Sell
              </button>
            </div>
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Amount</label>
          <div className="mt-1 flex rounded-md shadow-sm">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 min-w-0 input"
              placeholder="0.00"
              step="0.0001"
              min="0"
              required
              disabled={isLoading}
            />
            <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
              {pair.split('-')[0]}
            </span>
          </div>
        </div>
        
        {orderType === 'LIMIT' && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Price</label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="flex-1 min-w-0 input"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
                disabled={isLoading}
              />
              <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                USDT
              </span>
            </div>
          </div>
        )}
        
        {orderStatus && (
          <div className={`text-sm p-2 rounded ${
            orderStatus.includes('failed') || orderStatus.includes('Failed') 
              ? 'bg-red-100 text-red-700' 
              : 'bg-green-100 text-green-700'
          }`}>
            {orderStatus}
          </div>
        )}
        
        <div className="pt-2">
          <button
            type="submit"
            className={`w-full btn ${
              side === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            } text-white`}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : `${side === 'BUY' ? 'Buy' : 'Sell'} ${pair.split('-')[0]}`}
          </button>
        </div>
      </div>
    </form>
  );
};

export default QuickTrade;