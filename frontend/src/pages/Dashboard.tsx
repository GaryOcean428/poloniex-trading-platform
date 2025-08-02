import React from 'react';
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
import { mockTrades } from '../data/mockData';
import { Activity, ArrowRight } from 'lucide-react';

const Dashboard: React.FC = () => {
  const { marketData, strategies, activeStrategies, trades, isMockMode } = useTradingContext();
  
  return (
    <div className="container-responsive">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-neutral-800">Trading Dashboard</h1>
        
        <div className="flex items-center space-x-3">
          {/* Live Trading CTA */}
          <Link
            to="/dashboard/live"
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
          >
            <Activity size={16} />
            <span>Go Live</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      
      <div className="mb-4 lg:mb-6">
        <ExtensionBanner />
      </div>
      
      {/* Real-time Market Ticker */}
      <div className="mb-4 lg:mb-6">
        <RealTimeMarketTicker />
      </div>

      {/* Autonomous Trading Dashboard */}
      <div className="mb-4 lg:mb-6">
        <AutonomousTradingDashboard />
      </div>
      
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 space-y-4 lg:space-y-6">
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
              <RecentTrades trades={trades.length > 0 ? trades : mockTrades} />
            </div>
          </section>
        </div>
        
        <aside className="space-y-4 lg:space-y-6" aria-label="Account information and controls">
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
                    className="p-3 sm:p-4 bg-blue-50 border border-blue-100 rounded-md"
                    role="listitem"
                    aria-labelledby={`strategy-${strategy.id}-name`}
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 id={`strategy-${strategy.id}-name`} className="font-medium text-sm sm:text-base truncate">
                          {strategy.name}
                        </h3>
                        <p className="text-xs sm:text-sm text-neutral-500" aria-label={`Trading pair: ${strategy.parameters.pair}`}>
                          {strategy.parameters.pair}
                        </p>
                      </div>
                      <span 
                        className="inline-flex items-center px-2 py-1 sm:px-2.5 sm:py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 self-start sm:self-auto"
                        aria-label="Strategy status: Active"
                      >
                        Active
                      </span>
                    </div>
                  </div>
                ))}
              
              {activeStrategies.length === 0 && (
                <p className="text-neutral-500 text-sm text-center py-4" role="status" aria-live="polite">
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
          <section aria-labelledby="ai-insights-heading">
            <h2 id="ai-insights-heading" className="sr-only">AI Trading Insights</h2>
            <TradingInsights
              symbol="BTC-USDT"
              price={marketData && marketData.length > 0 ? (marketData[marketData.length - 1]?.close ?? 41704) : 41704}
              change24h={-5.91}
              volume={569500}
            />
          </section>
        </aside>
      </div>
    </div>
  );
};

export default Dashboard;