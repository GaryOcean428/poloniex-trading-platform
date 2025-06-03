import React from 'react';
import { useTradingContext } from '../context/TradingContext';
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
      {isMockMode && <div className="lg:col-span-3"><MockModeNotice /></div>}
      
      <div className="lg:col-span-3 mb-2">
        <ExtensionBanner />
      </div>
      
      <div className="lg:col-span-2 space-y-4">
        <div className="trading-card">
          <h2 className="text-xl font-bold mb-4">Market Overview</h2>
          <PriceChart data={marketData} pair="BTC-USDT" />
        </div>
        
        <div className="trading-card">
          <h2 className="text-xl font-bold mb-4">Strategy Performance</h2>
          <StrategyPerformance strategies={strategies} />
        </div>
        
        <div className="trading-card">
          <h2 className="text-xl font-bold mb-4">Recent Trades</h2>
          <RecentTrades trades={trades.length > 0 ? trades : mockTrades} />
        </div>
      </div>
      
      <div className="space-y-4">
        <div className="trading-card">
          <AccountSummary />
        </div>
        
        <div className="trading-card">
          <h2 className="text-xl font-bold mb-4">Active Strategies</h2>
          <div className="space-y-2">
            {strategies
              .filter(strategy => activeStrategies.includes(strategy.id))
              .map(strategy => (
                <div 
                  key={strategy.id} 
                  className="p-3 bg-blue-50 border border-blue-100 rounded-md"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-medium">{strategy.name}</h3>
                      <p className="text-sm text-neutral-500">{strategy.parameters.pair}</p>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Active
                    </span>
                  </div>
                </div>
              ))}
            
            {activeStrategies.length === 0 && (
              <p className="text-neutral-500 text-sm">No active strategies</p>
            )}
          </div>
        </div>
        
        <div className="trading-card">
          <h2 className="text-xl font-bold mb-4">Quick Trade</h2>
          <QuickTrade />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;