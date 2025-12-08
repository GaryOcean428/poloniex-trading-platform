import React from 'react';
import { Strategy } from '../../types';
import { TrendingUp, TrendingDown, BarChart2 } from 'lucide-react';

interface StrategyPerformanceProps {
  strategies: Strategy[];
}

const StrategyPerformance: React.FC<StrategyPerformanceProps> = ({ strategies }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {strategies.map(strategy => (
        <div 
          key={strategy.id} 
          className="bg-bg-tertiary border border-border-subtle rounded-lg p-4 hover:shadow-elev-2 transition-all duration-200 shadow-elev-1"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-text-primary">{strategy.name}</h3>
              <p className="text-xs text-text-muted mt-0.5">{strategy.parameters.pair}</p>
            </div>
            <div className="p-2 rounded-full bg-brand-cyan/10">
              <BarChart2 className="h-5 w-5 text-brand-cyan" />
            </div>
          </div>
          
          {strategy.performance && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Total P&L</span>
                <span className={`font-semibold ${
                  strategy.performance.totalPnL >= 0 ? 'text-success' : 'text-error'
                }`}>
                  {strategy.performance.totalPnL >= 0 ? '+' : ''}
                  {strategy.performance.totalPnL.toFixed(2)}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Win Rate</span>
                <span className="font-semibold flex items-center text-text-primary">
                  {(strategy.performance.winRate * 100).toFixed(1)}%
                  {strategy.performance.winRate >= 0.5 ? (
                    <TrendingUp className="h-4 w-4 ml-1 text-success" />
                  ) : (
                    <TrendingDown className="h-4 w-4 ml-1 text-error" />
                  )}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Trades</span>
                <span className="font-semibold text-text-primary">{strategy.performance.tradesCount}</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default StrategyPerformance;
