import React, { useState } from 'react';
import { useTradingContext } from '../hooks/useTradingContext';
import PriceChart from '../components/charts/PriceChart';
import { BarChart2, TrendingUp, TrendingDown, Volume2, ArrowRight } from 'lucide-react';

const MarketAnalysis: React.FC = () => {
  const { marketData } = useTradingContext();
  const [selectedPair, setSelectedPair] = useState('BTC-USDT');
  
  // Filter data for selected pair
  const pairData = marketData.filter(data => data.pair === selectedPair);
  
  // Calculate market metrics
  const latestPrice = pairData[pairData.length - 1]?.close || 0;
  const previousPrice = pairData[pairData.length - 2]?.close || 0;
  const priceChange = latestPrice - previousPrice;
  const priceChangePercent = (priceChange / previousPrice) * 100;
  
  const volume24h = pairData.reduce((sum, data) => sum + data.volume, 0);
  
  // Calculate price ranges
  const high24h = Math.max(...pairData.map(data => data.high));
  const low24h = Math.min(...pairData.map(data => data.low));
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="heading-primary">Market Analysis</h1>
        <select
          value={selectedPair}
          onChange={(e) => setSelectedPair(e.target.value)}
          className="px-3 py-2 border border-border-moderate rounded-md focus:outline-none focus:ring-2 focus:ring-brand-cyan"
        >
          <option value="BTC-USDT">BTC/USDT</option>
          <option value="ETH-USDT">ETH/USDT</option>
          <option value="SOL-USDT">SOL/USDT</option>
        </select>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-4 border border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <BarChart2 className="h-5 w-5 text-brand-cyan mr-2" />
              <span className="text-text-secondary">Current Price</span>
            </div>
            <span className="text-lg font-semibold text-text-primary">${latestPrice.toFixed(2)}</span>
          </div>
        </div>
        
        <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-4 border border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {priceChange >= 0 ? (
                <TrendingUp className="h-5 w-5 text-success mr-2" />
              ) : (
                <TrendingDown className="h-5 w-5 text-error mr-2" />
              )}
              <span className="text-text-secondary">24h Change</span>
            </div>
            <span className={`text-lg font-semibold ${priceChange >= 0 ? 'text-success' : 'text-error'}`}>
              {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
            </span>
          </div>
        </div>
        
        <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-4 border border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Volume2 className="h-5 w-5 text-brand-purple mr-2" />
              <span className="text-text-secondary">24h Volume</span>
            </div>
            <span className="text-lg font-semibold text-text-primary">${volume24h.toLocaleString()}</span>
          </div>
        </div>
        
        <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-4 border border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <ArrowRight className="h-5 w-5 text-warning mr-2" />
              <span className="text-text-secondary">24h Range</span>
            </div>
            <span className="text-lg font-semibold text-text-primary">
              ${low24h.toFixed(2)} - ${high24h.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
      
      <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-6 border border-border-subtle">
        <h2 className="heading-secondary mb-4">Price Chart</h2>
        <div className="h-[400px]">
          <PriceChart data={marketData} pair={selectedPair} />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-6 border border-border-subtle">
          <h2 className="heading-secondary mb-4">Order Book</h2>
          <div className="space-y-2">
            {/* Order book would be populated with real data */}
            <div className="flex justify-between text-sm">
              <span className="text-green-600">50,123.45</span>
              <span>0.5234 BTC</span>
              <span>$25,234.56</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-green-600">50,120.00</span>
              <span>1.2345 BTC</span>
              <span>$61,873.14</span>
            </div>
            <div className="border-t border-b border-border-subtle py-2 my-2">
              <div className="text-center font-bold text-text-primary">
                $50,125.50
                <span className="text-text-secondary ml-2">Current Price</span>
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-red-600">50,127.80</span>
              <span>0.8765 BTC</span>
              <span>$43,936.92</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-red-600">50,130.25</span>
              <span>0.3456 BTC</span>
              <span>$17,325.00</span>
            </div>
          </div>
        </div>
        
        <div className="bg-bg-tertiary rounded-lg shadow-elev-2 p-6 border border-border-subtle">
          <h2 className="heading-secondary mb-4">Recent Trades</h2>
          <div className="space-y-2">
            {/* Recent trades would be populated with real data */}
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">12:45:23</span>
              <span className="text-success">Buy</span>
              <span className="text-text-primary">0.1234 BTC</span>
              <span className="text-text-primary">$50,123.45</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">12:45:21</span>
              <span className="text-error">Sell</span>
              <span className="text-text-primary">0.0567 BTC</span>
              <span className="text-text-primary">$50,120.00</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">12:45:18</span>
              <span className="text-success">Buy</span>
              <span className="text-text-primary">0.3456 BTC</span>
              <span className="text-text-primary">$50,118.75</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">12:45:15</span>
              <span className="text-error">Sell</span>
              <span className="text-text-primary">0.2345 BTC</span>
              <span className="text-text-primary">$50,115.50</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketAnalysis;
