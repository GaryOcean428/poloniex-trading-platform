import React, { useState, useEffect, useCallback } from 'react';
import { useTradingContext } from '../hooks/useTradingContext';
import { useWebSocket } from '../services/websocketService';
import LiveDataDashboard from '../components/dashboard/LiveDataDashboard';
import RealTimePortfolio from '../components/dashboard/RealTimePortfolio';
import RealTimeAlerts from '../components/dashboard/RealTimeAlerts';
import RecentTrades from '../components/dashboard/RecentTrades';
import StrategyPerformance from '../components/dashboard/StrategyPerformance';
import { 
  Activity, 
  Clock,
  Wifi,
  WifiOff
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface RealTimeMetric {
  timestamp: number;
  value: number;
  change: number;
  changePercent: number;
}

// Interface for future alert functionality
// interface LiveAlert {
//   id: string;
//   type: 'success' | 'warning' | 'error' | 'info';
//   message: string;
//   timestamp: number;
//   acknowledged: boolean;
// }

const LiveTradingDashboard: React.FC = () => {
  const { 
    // marketData, 
    strategies, 
    // activeStrategies, 
    trades, 
    isMockMode 
  } = useTradingContext();
  
  const { 
    connectionState: _connectionState, 
    isMockMode: wsIsMockMode, 
    isConnected,
    on,
    off
  } = useWebSocket();

  const [priceHistory, setPriceHistory] = useState<RealTimeMetric[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>('BTC-USDT');
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);

  // Available trading pairs for live monitoring
  const tradingPairs = [
    'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 
    'ADA-USDT', 'DOGE-USDT', 'MATIC-USDT', 'DOT-USDT'
  ];

  // Handle real-time market data
  const handleMarketData = useCallback((data: unknown) => {
    if (data.pair === selectedPair) {
      const newMetric: RealTimeMetric = {
        timestamp: data.timestamp || Date.now(),
        value: data.close || data.price,
        change: data.change || 0,
        changePercent: data.changePercent || 0
      };

      // Update real-time price data for this pair
      // Note: This would be used by a price display component
      
      // Update price history (keep last 50 points)
      setPriceHistory(prev => {
        const updated = [...prev, newMetric];
        return updated.slice(-50);
      });
    }
  }, [selectedPair]);

  // Handle real-time trade execution
  const handleTradeExecuted = useCallback((tradeData: unknown) => {
    // This will be handled by the RealTimeAlerts component
    // console.log('Trade executed:', tradeData);
  }, []);

  // Set up WebSocket event listeners
  useEffect(() => {
    if (isLiveMode && isConnected) {
      on('marketData', handleMarketData);
      on('tradeExecuted', handleTradeExecuted);

      return () => {
        off('marketData', handleMarketData);
        off('tradeExecuted', handleTradeExecuted);
      };
    }
  }, [isLiveMode, isConnected, handleMarketData, handleTradeExecuted, on, off]);

  // Toggle live mode
  const toggleLiveMode = () => {
    setIsLiveMode(!isLiveMode);
    if (!isLiveMode) {
      // Clear existing data when starting live mode
      setPriceHistory([]);
    }
  };

  // Format chart data for real-time price chart
  const formatPriceChartData = () => {
    const labels = priceHistory.map(point => 
      new Date(point.timestamp).toLocaleTimeString()
    );
    
    return {
      labels,
      datasets: [
        {
          label: `${selectedPair} Price`,
          data: priceHistory.map(point => point.value),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.1
        }
      ]
    };
  };

  // Chart options
  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: `Real-time ${selectedPair} Price`
      }
    },
    scales: {
      y: {
        beginAtZero: false,
      }
    },
    animation: {
      duration: 0 // No animation for real-time updates
    }
  };

  return (
    <div className="container-responsive">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-neutral-800">Real-time Trading Dashboard</h1>
        
        <div className="flex items-center space-x-4">
          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            {isConnected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            <span className="text-sm text-neutral-600">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Pair Selector */}
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="block w-32 px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            {tradingPairs.map(pair => (
              <option key={pair} value={pair}>{pair}</option>
            ))}
          </select>

          {/* Live Mode Toggle */}
          <button
            onClick={toggleLiveMode}
            className={`flex items-center space-x-2 px-4 py-2 rounded-md font-medium transition-colors ${
              isLiveMode 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            <Activity size={16} />
            <span>{isLiveMode ? 'Stop Live' : 'Start Live'}</span>
          </button>
        </div>
      </div>

      {/* Real-time Portfolio Overview */}
      <div className="mb-6">
        <RealTimePortfolio />
      </div>

      {/* Real-time Price Chart and Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Real-time Price Chart */}
        <div className="lg:col-span-2 trading-card">
          <h3 className="text-lg font-medium mb-4">Real-time Price Movement</h3>
          <div className="h-64">
            {priceHistory.length > 0 ? (
              <Line data={formatPriceChartData()} options={chartOptions} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Clock className="h-12 w-12 text-neutral-400 mx-auto mb-2" />
                  <p className="text-neutral-500">
                    {isLiveMode ? 'Waiting for real-time data...' : 'Start live mode to see real-time updates'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Alerts */}
        <div className="trading-card">
          <RealTimeAlerts maxAlerts={10} />
        </div>
      </div>

      {/* Advanced Live Data Dashboard */}
      <div className="mb-6">
        <LiveDataDashboard />
      </div>

      {/* Strategy Performance and Recent Trades */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="trading-card">
          <h3 className="text-lg font-medium mb-4">Live Strategy Performance</h3>
          <StrategyPerformance strategies={strategies} />
        </div>

        <div className="trading-card">
          <h3 className="text-lg font-medium mb-4">Recent Live Trades</h3>
          <RecentTrades trades={trades} />
        </div>
      </div>
    </div>
  );
};

export default LiveTradingDashboard;