import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTradingContext } from '../hooks/useTradingContext';
import PriceChart from '../components/charts/PriceChart';
import StrategyPerformance from '../components/dashboard/StrategyPerformance';
import RecentTrades from '../components/dashboard/RecentTrades';
import AccountSummary from '../components/dashboard/AccountSummary';
import QuickTrade from '../components/dashboard/QuickTrade';
import RealTimeMarketTicker from '../components/dashboard/RealTimeMarketTicker';
import TradingInsights from '../components/TradingInsights';
import ExtensionBanner from '../components/dashboard/ExtensionBanner';
import AutonomousTradingDashboard from '../components/trading/AutonomousTradingDashboard';
import MLModelPerformance from '../components/ml/MLModelPerformance';
import AccountBalanceWidget from '../components/dashboard/AccountBalanceWidget';
import ActivePositionsWidget from '../components/dashboard/ActivePositionsWidget';
import RecentTradesWidget from '../components/dashboard/RecentTradesWidget';
import { Activity, ArrowRight } from 'lucide-react';
import { poloniexApi } from '../services/poloniexAPI';

const Dashboard: React.FC = () => {
  const { marketData: contextMarketData, strategies, activeStrategies, trades } = useTradingContext();
  const [liveMarketData, setLiveMarketData] = useState<any[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(true);
  
  // Fetch live market data for chart
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        const data = await poloniexApi.getHistoricalData('BTC-USDT', '1h', 100);
        setLiveMarketData(data || []);
      } catch (error) {
        console.error('Error fetching market data:', error);
        setLiveMarketData(contextMarketData);
      } finally {
        setLoadingMarket(false);
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [contextMarketData]);
  
  const marketData = liveMarketData.length > 0 ? liveMarketData : contextMarketData;
  
  return (
    <div className="container-responsive">
      <div className="flex items-center justify-between mb-8">
        <h1 className="heading-primary">Trading Dashboard</h1>
        
        <div className="flex items-center space-x-3">
          <Link
            to="/dashboard/live"
            className="flex items-center space-x-2 px-5 py-2.5 bg-success text-text-inverse rounded-lg hover:bg-success/90 transition-all duration-200 font-semibold shadow-elev-1 hover:shadow-elev-2"
          >
            <Activity size={16} />
            <span>Go Live</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      
      <div className="mb-6 lg:mb-8">
        <ExtensionBanner />
      </div>
      
      <div className="mb-6 lg:mb-8">
        <RealTimeMarketTicker />
      </div>

      <div className="mb-6 lg:mb-8">
        <AutonomousTradingDashboard />
      </div>

      {/* ML Model Performance */}
      <div className="mb-6 lg:mb-8">
        <MLModelPerformance symbol="BTCUSDTPERP" />
      </div>

      {/* Account Balance & Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 lg:mb-8">
        <AccountBalanceWidget />
        <div className="lg:col-span-2">
          <ActivePositionsWidget />
        </div>
      </div>

      {/* Recent Trades from API */}
      <div className="mb-6 lg:mb-8">
        <RecentTradesWidget />
      </div>
      
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
        <div className="xl:col-span-2 space-y-6 lg:space-y-8">
          <section className="trading-card" aria-labelledby="market-overview-heading">
            <h2 id="market-overview-heading" className="text-lg sm:text-xl font-bold mb-4">Market Overview</h2>
            <div className="chart-container">
              <PriceChart data={marketData} pair="BTC-USDT" />
            </div>
          </section>
          
          <section className="trading-card" aria-labelledby="strategy-performance-heading">
            <h2 id="strategy-performance-heading" className="text-lg sm:text-xl font-bold mb-4">Strategy Performance</h2>
            <div className="overflow-x-auto">
              <StrategyPerformance strategies={strategies} />
            </div>
          </section>
          
          <section className="trading-card" aria-labelledby="recent-trades-heading">
            <h2 id="recent-trades-heading" className="text-lg sm:text-xl font-bold mb-4">Recent Trades</h2>
            <div className="table-responsive">
              <RecentTrades trades={trades} />
            </div>
          </section>
        </div>
        
        <aside className="space-y-6 lg:space-y-8" aria-label="Account information and controls">
          <section className="trading-card" aria-labelledby="account-summary-heading">
            <h2 id="account-summary-heading" className="sr-only">Account Summary</h2>
            <AccountSummary />
          </section>
          
          <section className="trading-card" aria-labelledby="active-strategies-heading">
            <h2 id="active-strategies-heading" className="text-lg sm:text-xl font-bold mb-4">Active Strategies</h2>
            <div className="space-y-2 sm:space-y-3" role="list" aria-label="List of active trading strategies">
              {strategies
                .filter(strategy => activeStrategies.includes(strategy.id))
                .map(strategy => (
                  <div 
                    key={strategy.id} 
                    className="p-4 bg-bg-elevated border border-border-subtle rounded-lg shadow-elev-1 hover:shadow-elev-2 transition-all duration-200"
                    role="listitem"
                    aria-labelledby={`strategy-${strategy.id}-name`}
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 id={`strategy-${strategy.id}-name`} className="font-semibold text-sm sm:text-base truncate text-text-primary">
                          {strategy.name}
                        </h3>
                        <p className="text-xs sm:text-sm text-text-secondary" aria-label={`Trading pair: ${strategy.parameters.pair}`}>
                          {strategy.parameters.pair}
                        </p>
                      </div>
                      <span 
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/20 self-start sm:self-auto"
                        aria-label="Strategy status: Active"
                      >
                        Active
                      </span>
                    </div>
                  </div>
                ))}
              
              {activeStrategies.length === 0 && (
                <p className="text-text-muted text-sm text-center py-4" role="status" aria-live="polite">
                  No active strategies
                </p>
              )}
            </div>
          </section>
          
          <section className="trading-card" aria-labelledby="quick-trade-heading">
            <h2 id="quick-trade-heading" className="text-lg sm:text-xl font-bold mb-4">Quick Trade</h2>
            <QuickTrade />
          </section>

          {/* AI Trading Insights */}
          {marketData && marketData.length > 0 && (() => {
            const latestPrice = marketData[marketData.length - 1]?.close ?? 0;
            const previousPrice = marketData[marketData.length - 2]?.close ?? 0;
            const change24h = marketData.length >= 2 && previousPrice > 0 
              ? ((latestPrice - previousPrice) / previousPrice * 100) 
              : 0;
            
            return (
              <section aria-labelledby="ai-insights-heading">
                <h2 id="ai-insights-heading" className="sr-only">AI Trading Insights</h2>
                <TradingInsights
                  symbol="BTC-USDT"
                  price={latestPrice}
                  change24h={change24h}
                  volume={marketData[marketData.length - 1]?.volume ?? 0}
                />
              </section>
            );
          })()}
        </aside>
      </div>
    </div>
  );
};

export default Dashboard;
