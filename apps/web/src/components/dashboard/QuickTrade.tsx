import { useState } from 'react';
import { useTradingContext } from '../../hooks/useTradingContext';

const QuickTrade: React.FC = () => {
  const { placeOrder, isLoading } = useTradingContext();
  const [pair, setPair] = useState('BTC-USDT');
  const [orderType, setOrderType] = useState('LIMIT');
  const [side, setSide] = useState('BUY');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  
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
      
      // console.log('Order placed:', result);
      setOrderStatus(`Order successfully placed: ${(result as any)?.orderId || 'Success'}`);
      
      // Reset form
      setAmount('');
      setPrice('');
    } catch (error) {
      // console.error('Failed to place order:', error);
      setOrderStatus(`Order failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1.5">Pair</label>
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
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1.5">Type</label>
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
            <label className="block text-sm font-semibold text-text-primary mb-1.5">Side</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`py-2 text-center rounded-md font-semibold transition-all ${
                  side === 'BUY'
                    ? 'bg-success text-text-inverse shadow-elev-1'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
                }`}
                onClick={() => setSide('BUY')}
                disabled={isLoading}
              >
                Buy
              </button>
              <button
                type="button"
                className={`py-2 text-center rounded-md font-semibold transition-all ${
                  side === 'SELL'
                    ? 'bg-error text-text-inverse shadow-elev-1'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
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
          <label className="block text-sm font-semibold text-text-primary mb-1.5">Amount</label>
          <div className="mt-1 flex rounded-md">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 min-w-0 input rounded-r-none"
              placeholder="0.00"
              step="0.0001"
              min="0"
              required
              disabled={isLoading}
            />
            <span className="inline-flex items-center px-3 rounded-r-md border-2 border-l-0 border-border-moderate bg-bg-secondary text-text-secondary text-sm font-medium">
              {pair.split('-')[0]}
            </span>
          </div>
        </div>
        
        {orderType === 'LIMIT' && (
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1.5">Price</label>
            <div className="mt-1 flex rounded-md">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="flex-1 min-w-0 input rounded-r-none"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
                disabled={isLoading}
              />
              <span className="inline-flex items-center px-3 rounded-r-md border-2 border-l-0 border-border-moderate bg-bg-secondary text-text-secondary text-sm font-medium">
                USDT
              </span>
            </div>
          </div>
        )}
        
        {orderStatus && (
          <div className={`text-sm p-3 rounded-lg font-medium ${
            orderStatus.includes('failed') || orderStatus.includes('Failed') 
              ? 'bg-error/10 text-error border border-error/20' 
              : 'bg-success/10 text-success border border-success/20'
          }`}>
            {orderStatus}
          </div>
        )}
        
        <div className="pt-2">
          <button
            type="submit"
            className={`w-full btn py-3 rounded-lg font-semibold shadow-elev-1 hover:shadow-elev-2 transition-all ${
              side === 'BUY' ? 'bg-success hover:bg-success/90 text-text-inverse' : 'bg-error hover:bg-error/90 text-text-inverse'
            }`}
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
