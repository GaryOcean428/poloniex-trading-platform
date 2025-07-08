import React from 'react';
import { useTradingContext } from '../hooks/useTradingContext';
import PriceChart from '../components/charts/PriceChart';
import StrategyPerformance from '../components/dashboard/StrategyPerformance';
import RecentTrades from '../components/dashboard/RecentTrades';
import AccountSummary from '../components/dashboard/AccountSummary';
import QuickTrade from '../components/dashboard/QuickTrade';
import MockModeNotice from '../components/MockModeNotice';
import ExtensionBanner from '../components/dashboard/ExtensionBanner';
import { mockTrades } from '../data/mockData';

const Dashboard: React.FC = () => {
  const { marketData, strategies, activeStrategies, trades, isMockMode } = useTradingContext();
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <h1 className="sr-only">Trading Dashboard</h1>
      
      {isMockMode && (
        <div className="lg:col-span-3">
          <MockModeNotice />
        </div>
      )}
      
      <div className="lg:col-span-3 mb-2">
        <ExtensionBanner />
      </div>
      
      <div className="lg:col-span-2 space-y-4">
        <section className="trading-card" aria-labelledby="market-overview-heading">
          <h2 id="market-overview-heading" className="text-xl font-bold mb-4">Market Overview</h2>
          <PriceChart data={marketData} pair="BTC-USDT" />
        </section>
        
        <section className="trading-card" aria-labelledby="strategy-performance-heading">
          <h2 id="strategy-performance-heading" className="text-xl font-bold mb-4">Strategy Performance</h2>
          <StrategyPerformance strategies={strategies} />
        </section>
        
        <section className="trading-card" aria-labelledby="recent-trades-heading">
          <h2 id="recent-trades-heading" className="text-xl font-bold mb-4">Recent Trades</h2>
          <RecentTrades trades={trades.length > 0 ? trades : mockTrades} />
        </section>
      </div>
      
      <aside className="space-y-4" aria-label="Account information and controls">
        <section className="trading-card" aria-labelledby="account-summary-heading">
          <h2 id="account-summary-heading" className="sr-only">Account Summary</h2>
          <AccountSummary />
        </section>
        
        <section className="trading-card" aria-labelledby="active-strategies-heading">
          <h2 id="active-strategies-heading" className="text-xl font-bold mb-4">Active Strategies</h2>
          <div className="space-y-2" role="list" aria-label="List of active trading strategies">
            {strategies
              .filter(strategy => activeStrategies.includes(strategy.id))
              .map(strategy => (
                <div 
                  key={strategy.id} 
                  className="p-3 bg-blue-50 border border-blue-100 rounded-md"
                  role="listitem"
                  aria-labelledby={`strategy-${strategy.id}-name`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 id={`strategy-${strategy.id}-name`} className="font-medium">{strategy.name}</h3>
                      <p className="text-sm text-neutral-500" aria-label={`Trading pair: ${strategy.parameters.pair}`}>
                        {strategy.parameters.pair}
                      </p>
                    </div>
                    <span 
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                      aria-label="Strategy status: Active"
                    >
                      Active
                    </span>
                  </div>
                </div>
              ))}
            
            {activeStrategies.length === 0 && (
              <p className="text-neutral-500 text-sm" role="status" aria-live="polite">
                No active strategies
              </p>
            )}
          </div>
        </section>
        
        <section className="trading-card" aria-labelledby="quick-trade-heading">
          <h2 id="quick-trade-heading" className="text-xl font-bold mb-4">Quick Trade</h2>
          <QuickTrade />
        </section>
      </aside>
    </div>
  );
};

export default Dashboard;