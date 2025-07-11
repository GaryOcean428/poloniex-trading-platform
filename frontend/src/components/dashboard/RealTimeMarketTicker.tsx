import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff } from 'lucide-react';
import { useWebSocket } from '../../services/websocketService';
import { useTradingContext } from '../../hooks/useTradingContext';

interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  lastUpdateTime: Date;
}

const RealTimeMarketTicker: React.FC = () => {
  const { isConnected, isMockMode } = useWebSocket();
  const { marketData, isMockMode: contextMockMode } = useTradingContext();
  const [tickerData, setTickerData] = useState<TickerData[]>([]);
  const [selectedPairs] = useState(['BTC-USDT', 'ETH-USDT', 'ADA-USDT', 'DOT-USDT']);

  // Generate mock ticker data for demonstration
  useEffect(() => {
    const generateMockTickerData = (): TickerData[] => {
      const mockPairs = [
        { symbol: 'BTC-USDT', basePrice: 43000 },
        { symbol: 'ETH-USDT', basePrice: 2500 },
        { symbol: 'ADA-USDT', basePrice: 0.45 },
        { symbol: 'DOT-USDT', basePrice: 6.5 }
      ];

      return mockPairs.map(pair => {
        const variance = (Math.random() - 0.5) * 0.1; // ±5% variance
        const price = pair.basePrice * (1 + variance);
        const change24h = pair.basePrice * (Math.random() - 0.5) * 0.2; // ±10% daily change
        const changePercent24h = (change24h / pair.basePrice) * 100;

        return {
          symbol: pair.symbol,
          price,
          change24h,
          changePercent24h,
          volume24h: Math.random() * 1000000,
          high24h: price * (1 + Math.random() * 0.05),
          low24h: price * (1 - Math.random() * 0.05),
          lastUpdateTime: new Date()
        };
      });
    };

    // Set initial mock data
    setTickerData(generateMockTickerData());

    // Update ticker data every 2 seconds to simulate real-time updates
    const interval = setInterval(() => {
      setTickerData(prevData => 
        prevData.map(ticker => {
          const priceChange = (Math.random() - 0.5) * ticker.price * 0.001; // ±0.1% change
          const newPrice = Math.max(0.01, ticker.price + priceChange);
          const change24h = ticker.change24h + priceChange;
          const changePercent24h = (change24h / (newPrice - change24h)) * 100;

          return {
            ...ticker,
            price: newPrice,
            change24h,
            changePercent24h,
            lastUpdateTime: new Date()
          };
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const formatPrice = (price: number, symbol: string) => {
    if (symbol.includes('BTC')) return price.toFixed(0);
    if (symbol.includes('ETH')) return price.toFixed(0);
    return price.toFixed(4);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `${(volume / 1000).toFixed(1)}K`;
    }
    return volume.toFixed(0);
  };

  const getConnectionStatusColor = () => {
    if (isConnected && !isMockMode && !contextMockMode) {
      return 'bg-green-500';
    } else if (isMockMode || contextMockMode) {
      return 'bg-yellow-500';
    } else {
      return 'bg-red-500';
    }
  };

  const getConnectionStatusText = () => {
    if (isConnected && !isMockMode && !contextMockMode) {
      return 'Live Data';
    } else if (isMockMode || contextMockMode) {
      return 'Mock Data';
    } else {
      return 'Offline';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <Activity className="w-5 h-5 mr-2 text-blue-600" />
          Market Ticker
        </h3>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${getConnectionStatusColor()} animate-pulse`}></div>
          <span className="text-xs text-gray-600">{getConnectionStatusText()}</span>
          {isConnected ? 
            <Wifi className="w-4 h-4 text-green-600" /> : 
            <WifiOff className="w-4 h-4 text-red-600" />
          }
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {tickerData.map((ticker) => (
          <div 
            key={ticker.symbol}
            className="border border-gray-200 rounded-md p-3 hover:border-blue-300 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-900">{ticker.symbol}</span>
              {ticker.changePercent24h >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-600" />
              )}
            </div>
            
            <div className="space-y-1">
              <div className="text-xl font-bold text-gray-900">
                ${formatPrice(ticker.price, ticker.symbol)}
              </div>
              
              <div className={`text-sm font-medium ${
                ticker.changePercent24h >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {ticker.changePercent24h >= 0 ? '+' : ''}{ticker.changePercent24h.toFixed(2)}%
                <span className="ml-1 text-gray-500">
                  ({ticker.change24h >= 0 ? '+' : ''}${ticker.change24h.toFixed(2)})
                </span>
              </div>
              
              <div className="text-xs text-gray-500 space-y-0.5">
                <div>Vol: {formatVolume(ticker.volume24h)}</div>
                <div>H: ${formatPrice(ticker.high24h, ticker.symbol)} L: ${formatPrice(ticker.low24h, ticker.symbol)}</div>
              </div>
            </div>
            
            <div className="mt-2 text-xs text-gray-400">
              {ticker.lastUpdateTime.toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>

      {/* Real-time status indicator */}
      <div className="mt-4 flex items-center justify-center text-xs text-gray-500">
        <div className="flex items-center space-x-1">
          <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
          <span>Updates every 2 seconds</span>
        </div>
      </div>
    </div>
  );
};

export default RealTimeMarketTicker;