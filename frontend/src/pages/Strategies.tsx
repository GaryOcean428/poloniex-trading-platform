import { useState } from 'react';
import { useTradingContext } from '../hooks/useTradingContext';
import { Strategy, StrategyType } from '../types';
import { Plus, Zap, Settings as SettingsIcon, BarChart2, Play, Pause, Trash2, History, Sparkles } from 'lucide-react';
import NewStrategyForm from '../components/strategy/NewStrategyForm';
import StrategyDetails from '../components/strategy/StrategyDetails';
import { backtestService } from '../services/backtestService';
import { BacktestResult } from '../types/backtest';

const Strategies: React.FC = () => {
  const { strategies, activeStrategies, toggleStrategyActive, removeStrategy } = useTradingContext();
  const [showNewStrategyForm, setShowNewStrategyForm] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [backtestResults, setBacktestResults] = useState<BacktestResult | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  
  const runBacktest = async (strategy: Strategy) => {
    setIsBacktesting(true);
    try {
      const result = await backtestService.runBacktest(strategy, {
        startDate: '2023-01-01',
        endDate: '2024-01-01',
        initialBalance: 10000,
        feeRate: 0.001,
        slippage: 0.001,
        useHistoricalData: true
      });
      setBacktestResults(result);
    } catch (error) {
      console.error('Backtest failed:', error);
    } finally {
      setIsBacktesting(false);
    }
  };
  
  const optimizeStrategy = async (strategy: Strategy) => {
    setIsOptimizing(true);
    try {
      // Fix the parameter ranges to match the expected type
      const parameterRanges: Record<string, [number, number, number]> = {
        shortPeriod: [5, 20, 5],
        longPeriod: [20, 100, 20]
      };
      
      const results = await backtestService.optimizeStrategy(
        strategy,
        {
          startDate: '2023-01-01',
          endDate: '2024-01-01',
          initialBalance: 10000,
          feeRate: 0.001,
          slippage: 0.001,
          useHistoricalData: true
        },
        parameterRanges
      );
      
      // Update strategy with best parameters
      if (results.length > 0) {
        const bestResult = results[0];
        strategy.parameters = {
          ...strategy.parameters,
          ...bestResult.parameters
        };
      }
    } catch (error) {
      console.error('Optimization failed:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleSelectStrategy = (strategy: Strategy) => {
    setSelectedStrategy(strategy);
    setShowNewStrategyForm(false);
  };
  
  const getStrategyTypeIcon = (type: string) => {
    switch (type) {
      case StrategyType.MA_CROSSOVER:
        return <Zap className="h-5 w-5 text-blue-500" />;
      case StrategyType.RSI:
        return <BarChart2 className="h-5 w-5 text-purple-500" />;
      case StrategyType.BREAKOUT:
        return <SettingsIcon className="h-5 w-5 text-orange-500" />;
      default:
        return <Zap className="h-5 w-5 text-neutral-500" />;
    }
  };
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <div className="trading-card mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Your Strategies</h2>
            <button 
              className="btn btn-primary flex items-center"
              onClick={() => {
                setShowNewStrategyForm(true);
                setSelectedStrategy(null);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              New
            </button>
          </div>
          
          <div className="space-y-3">
            {strategies.map(strategy => (
              <div 
                key={strategy.id} 
                className={`border rounded-md p-3 cursor-pointer transition-colors duration-200 ${
                  selectedStrategy?.id === strategy.id 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-neutral-200 hover:border-blue-300'
                }`}
                onClick={() => handleSelectStrategy(strategy)}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center">
                    <div className="mr-3">
                      {getStrategyTypeIcon(strategy.type)}
                    </div>
                    <div>
                      <h3 className="font-medium">{strategy.name}</h3>
                      <p className="text-xs text-neutral-500">{strategy.parameters.pair}</p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button 
                      className={`p-1.5 rounded-md ${
                        activeStrategies.includes(strategy.id)
                          ? 'bg-green-100 text-green-700'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStrategyActive(strategy.id);
                      }}
                    >
                      {activeStrategies.includes(strategy.id) ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      className="p-1.5 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        runBacktest(strategy);
                      }}
                      disabled={isBacktesting}
                    >
                      <History className="h-4 w-4" />
                    </button>
                    <button
                      className="p-1.5 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        optimizeStrategy(strategy);
                      }}
                      disabled={isOptimizing}
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                    <button 
                      className="p-1.5 rounded-md bg-neutral-100 text-neutral-500 hover:bg-red-100 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeStrategy(strategy.id);
                        if (selectedStrategy?.id === strategy.id) {
                          setSelectedStrategy(null);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            
            {strategies.length === 0 && (
              <div className="text-center py-6 text-neutral-500">
                <Zap className="h-12 w-12 mx-auto text-neutral-300 mb-2" />
                <p>You don't have any strategies yet</p>
                <button 
                  className="mt-2 btn btn-primary"
                  onClick={() => setShowNewStrategyForm(true)}
                >
                  Create your first strategy
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="md:col-span-2">
        <div className="trading-card">
          {showNewStrategyForm ? (
            <NewStrategyForm onClose={() => setShowNewStrategyForm(false)} />
          ) : selectedStrategy ? (
            <StrategyDetails 
              strategy={selectedStrategy}
              backtestResults={backtestResults}
              isBacktesting={isBacktesting}
              isOptimizing={isOptimizing}
            />
          ) : (
            <div className="text-center py-12 text-neutral-500">
              <SettingsIcon className="h-16 w-16 mx-auto text-neutral-300 mb-3" />
              <h3 className="text-xl font-medium mb-2">No Strategy Selected</h3>
              <p>Select a strategy from the list or create a new one to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Strategies;
