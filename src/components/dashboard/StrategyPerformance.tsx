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
          className="bg-white border border-neutral-200 rounded-lg p-4 hover:shadow-md transition-shadow duration-200"
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-semibold">{strategy.name}</h3>
              <p className="text-xs text-neutral-500">{strategy.parameters.pair}</p>
            </div>
            <div className="p-2 rounded-full bg-blue-50">
              <BarChart2 className="h-5 w-5 text-blue-500" />
            </div>
          </div>
          
          {strategy.performance && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Total P&L</span>
                <span className={`font-medium ${
                  strategy.performance.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {strategy.performance.totalPnL >= 0 ? '+' : ''}
                  {strategy.performance.totalPnL.toFixed(2)}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Win Rate</span>
                <span className="font-medium flex items-center">
                  {(strategy.performance.winRate * 100).toFixed(1)}%
                  {strategy.performance.winRate >= 0.5 ? (
                    <TrendingUp className="h-4 w-4 ml-1 text-green-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 ml-1 text-red-500" />
                  )}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Trades</span>
                <span className="font-medium">{strategy.performance.tradesCount}</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default StrategyPerformance;