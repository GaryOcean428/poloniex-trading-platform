import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../../services/websocketService';
import { useTradingContext } from '../../hooks/useTradingContext';
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3,
  Wallet,
  Target
} from 'lucide-react';

interface PortfolioMetric {
  value: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

interface RealTimePortfolioData {
  totalValue: PortfolioMetric;
  availableBalance: PortfolioMetric;
  unrealizedPnL: PortfolioMetric;
  realizedPnL: PortfolioMetric;
  dayPnL: PortfolioMetric;
  openPositions: number;
  marginUsed: number;
  marginFree: number;
  totalEquity: number;
}

interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

interface TradeData {
  amount: number;
  price: number;
  profit: number;
  side: 'buy' | 'sell';
  symbol: string;
  timestamp: number;
}

interface RealTimePortfolioProps {
  refreshInterval?: number;
}

const RealTimePortfolio: React.FC<RealTimePortfolioProps> = ({ 
  refreshInterval = 5000 
}) => {
  const { accountBalance, activeStrategies } = useTradingContext();
  const { isConnected, on, off } = useWebSocket();
  
  const [portfolioData, setPortfolioData] = useState<RealTimePortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  // Initialize portfolio data from account balance
  const initializePortfolioData = useCallback(() => {
    if (accountBalance) {
      const totalValue = parseFloat(accountBalance.totalAmount || '0');
      const unrealizedPnL = parseFloat(accountBalance.unrealizedPnL || '0');
      const todayPnL = parseFloat(accountBalance.todayPnL || '0');
      const availableBalance = parseFloat(accountBalance.availableAmount || '0');

      const baseMetric = {
        change: 0,
        changePercent: 0,
        timestamp: Date.now()
      };

      setPortfolioData({
        totalValue: { value: totalValue, ...baseMetric },
        availableBalance: { value: availableBalance, ...baseMetric },
        unrealizedPnL: { 
          value: unrealizedPnL, 
          change: unrealizedPnL,
          changePercent: totalValue > 0 ? (unrealizedPnL / totalValue) * 100 : 0,
          timestamp: Date.now()
        },
        realizedPnL: { value: 0, ...baseMetric },
        dayPnL: { 
          value: todayPnL,
          change: todayPnL,
          changePercent: parseFloat(accountBalance.todayPnLPercentage || '0'),
          timestamp: Date.now()
        },
        openPositions: 0,
        marginUsed: 0,
        marginFree: availableBalance,
        totalEquity: totalValue
      });
      
      setIsLoading(false);
    }
  }, [accountBalance]);

  // Handle real-time trade execution updates
  const handleTradeExecuted = useCallback((tradeData: TradeData) => {
    setPortfolioData(prev => {
      if (!prev) return null;

      const tradeValue = (tradeData.amount || 0) * (tradeData.price || 0);
      const profit = tradeData.profit || 0;
      const isPositive = profit >= 0;

      return {
        ...prev,
        totalValue: {
          ...prev.totalValue,
          value: prev.totalValue.value + profit,
          change: profit,
          changePercent: prev.totalValue.value > 0 ? (profit / prev.totalValue.value) * 100 : 0,
          timestamp: Date.now()
        },
        realizedPnL: {
          ...prev.realizedPnL,
          value: prev.realizedPnL.value + profit,
          change: profit,
          changePercent: isPositive ? Math.abs(profit / tradeValue * 100) : -Math.abs(profit / tradeValue * 100),
          timestamp: Date.now()
        },
        dayPnL: {
          ...prev.dayPnL,
          value: prev.dayPnL.value + profit,
          change: profit,
          changePercent: prev.totalValue.value > 0 ? ((prev.dayPnL.value + profit) / prev.totalValue.value) * 100 : 0,
          timestamp: Date.now()
        },
        openPositions: tradeData.side === 'buy' ? prev.openPositions + 1 : Math.max(0, prev.openPositions - 1)
      };
    });

    setLastUpdate(Date.now());
  }, []);

  // Handle market data updates that might affect portfolio value
  const handleMarketData = useCallback((marketData: MarketData) => {
    // Update portfolio value based on market movements
    // This is a simplified calculation - in a real implementation,
    // you'd calculate based on actual holdings
    setPortfolioData(prev => {
      if (!prev) return null;

      // Simple simulation: portfolio moves with market
      const marketChange = marketData.changePercent || 0;
      const portfolioImpact = prev.totalValue.value * (marketChange / 100) * 0.1; // 10% correlation

      return {
        ...prev,
        unrealizedPnL: {
          ...prev.unrealizedPnL,
          value: prev.unrealizedPnL.value + portfolioImpact,
          change: portfolioImpact,
          changePercent: prev.totalValue.value > 0 ? (portfolioImpact / prev.totalValue.value) * 100 : 0,
          timestamp: Date.now()
        },
        totalValue: {
          ...prev.totalValue,
          value: prev.totalValue.value + portfolioImpact,
          change: portfolioImpact,
          changePercent: marketChange * 0.1, // Dampened market correlation
          timestamp: Date.now()
        }
      };
    });
  }, []);

  // Initialize data on component mount
  useEffect(() => {
    initializePortfolioData();
  }, [initializePortfolioData]);

  // Set up WebSocket listeners
  useEffect(() => {
    if (isConnected) {
      on('tradeExecuted', handleTradeExecuted);
      on('marketData', handleMarketData);

      return () => {
        off('tradeExecuted', handleTradeExecuted);
        off('marketData', handleMarketData);
      };
    }
  }, [isConnected, handleTradeExecuted, handleMarketData, on, off]);

  // Periodic refresh for data that might be stale
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(Date.now());
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  if (isLoading || !portfolioData) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="trading-card animate-pulse">
            <div className="h-20 bg-neutral-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getChangeColor = (value: number) => {
    return value >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const getChangeBgColor = (value: number) => {
    return value >= 0 ? 'bg-green-100' : 'bg-red-100';
  };

  const getChangeIcon = (value: number) => {
    return value >= 0 ? (
      <TrendingUp className="h-5 w-5 text-green-600" />
    ) : (
      <TrendingDown className="h-5 w-5 text-red-600" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Connection Status */}
      <div className="flex items-center justify-between text-sm text-neutral-500">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span>{isConnected ? 'Live updates active' : 'Offline mode'}</span>
        </div>
        <span>Last update: {new Date(lastUpdate).toLocaleTimeString()}</span>
      </div>

      {/* Portfolio Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Portfolio Value */}
        <div className="trading-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-500 mb-1">
                Total Portfolio
              </div>
              <div className="text-2xl font-bold text-neutral-800">
                {formatCurrency(portfolioData.totalValue.value)}
              </div>
              <div className={`text-sm font-medium ${getChangeColor(portfolioData.totalValue.changePercent)}`}>
                {formatPercent(portfolioData.totalValue.changePercent)}
              </div>
            </div>
            <div className={`p-2 rounded-full ${getChangeBgColor(portfolioData.totalValue.changePercent)}`}>
              <Wallet className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        {/* Day P&L */}
        <div className="trading-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-500 mb-1">
                Today's P&L
              </div>
              <div className="text-2xl font-bold text-neutral-800">
                {formatCurrency(portfolioData.dayPnL.value)}
              </div>
              <div className={`text-sm font-medium ${getChangeColor(portfolioData.dayPnL.changePercent)}`}>
                {formatPercent(portfolioData.dayPnL.changePercent)}
              </div>
            </div>
            <div className={`p-2 rounded-full ${getChangeBgColor(portfolioData.dayPnL.changePercent)}`}>
              {getChangeIcon(portfolioData.dayPnL.changePercent)}
            </div>
          </div>
        </div>

        {/* Unrealized P&L */}
        <div className="trading-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-500 mb-1">
                Unrealized P&L
              </div>
              <div className="text-2xl font-bold text-neutral-800">
                {formatCurrency(portfolioData.unrealizedPnL.value)}
              </div>
              <div className={`text-sm font-medium ${getChangeColor(portfolioData.unrealizedPnL.changePercent)}`}>
                {formatPercent(portfolioData.unrealizedPnL.changePercent)}
              </div>
            </div>
            <div className={`p-2 rounded-full ${getChangeBgColor(portfolioData.unrealizedPnL.changePercent)}`}>
              <BarChart3 className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        {/* Open Positions */}
        <div className="trading-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-500 mb-1">
                Open Positions
              </div>
              <div className="text-2xl font-bold text-neutral-800">
                {portfolioData.openPositions}
              </div>
              <div className="text-sm text-neutral-500">
                {activeStrategies.length} strategies active
              </div>
            </div>
            <div className="p-2 rounded-full bg-orange-100">
              <Target className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="trading-card">
          <h4 className="text-lg font-medium text-neutral-800 mb-3">Available Balance</h4>
          <div className="text-xl font-bold text-neutral-800">
            {formatCurrency(portfolioData.availableBalance.value)}
          </div>
          <div className="text-sm text-neutral-500 mt-1">
            Ready for trading
          </div>
        </div>

        <div className="trading-card">
          <h4 className="text-lg font-medium text-neutral-800 mb-3">Realized P&L</h4>
          <div className={`text-xl font-bold ${getChangeColor(portfolioData.realizedPnL.value)}`}>
            {formatCurrency(portfolioData.realizedPnL.value)}
          </div>
          <div className="text-sm text-neutral-500 mt-1">
            Closed positions
          </div>
        </div>

        <div className="trading-card">
          <h4 className="text-lg font-medium text-neutral-800 mb-3">Total Equity</h4>
          <div className="text-xl font-bold text-neutral-800">
            {formatCurrency(portfolioData.totalEquity)}
          </div>
          <div className="text-sm text-neutral-500 mt-1">
            Including unrealized
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealTimePortfolio;