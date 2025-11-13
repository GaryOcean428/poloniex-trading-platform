import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, Activity, CheckCircle, Clock, Zap, Target, BarChart3 } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

interface StrategyGeneration {
  id: string;
  strategy_name: string;
  status: 'generating' | 'analyzing' | 'backtesting' | 'completed' | 'failed';
  progress: number;
  current_step: string;
  indicators: string[];
  entry_conditions: string[];
  exit_conditions: string[];
  risk_parameters: {
    stop_loss: number;
    take_profit: number;
    position_size: number;
  };
  backtest_results?: {
    total_trades: number;
    win_rate: number;
    profit_factor: number;
    sharpe_ratio: number;
    max_drawdown: number;
  };
  created_at: Date;
  completed_at?: Date;
}

interface StrategyGenerationDisplayProps {
  agentStatus?: string;
}

const StrategyGenerationDisplay: React.FC<StrategyGenerationDisplayProps> = ({ agentStatus }) => {
  const [currentGeneration, setCurrentGeneration] = useState<StrategyGeneration | null>(null);
  const [recentStrategies, setRecentStrategies] = useState<StrategyGeneration[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (agentStatus === 'running') {
      fetchCurrentGeneration();
      fetchRecentStrategies();
      
      const interval = setInterval(() => {
        fetchCurrentGeneration();
        fetchRecentStrategies();
      }, 3000); // Update every 3 seconds for real-time feel

      return () => clearInterval(interval);
    }
  }, [agentStatus]);

  const fetchCurrentGeneration = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategy/current`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success && response.data.generation) {
        setCurrentGeneration(response.data.generation);
        setIsGenerating(response.data.generation.status !== 'completed' && response.data.generation.status !== 'failed');
      } else {
        setCurrentGeneration(null);
        setIsGenerating(false);
      }
    } catch (err: any) {
      console.error('Error fetching current generation:', err);
      setIsGenerating(false);
    }
  };

  const fetchRecentStrategies = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategy/recent?limit=5`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setRecentStrategies(response.data.strategies);
      }
    } catch (err: any) {
      console.error('Error fetching recent strategies:', err);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'generating':
        return <Brain className="w-5 h-5 text-blue-600 animate-pulse" />;
      case 'analyzing':
        return <Activity className="w-5 h-5 text-purple-600 animate-pulse" />;
      case 'backtesting':
        return <BarChart3 className="w-5 h-5 text-orange-600 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'failed':
        return <Clock className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'generating':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'analyzing':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'backtesting':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'failed':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  if (agentStatus !== 'running') {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          Strategy Generation Inactive
        </h3>
        <p className="text-gray-500">
          Start the autonomous agent to begin generating AI-powered trading strategies
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Generation Card */}
      {currentGeneration && (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon(currentGeneration.status)}
                <div>
                  <h3 className="text-xl font-bold">
                    {currentGeneration.strategy_name}
                  </h3>
                  <p className="text-sm opacity-90 mt-1">
                    {currentGeneration.current_step}
                  </p>
                </div>
              </div>
              <div className={`px-4 py-2 rounded-full border-2 ${getStatusColor(currentGeneration.status)} bg-white/20 backdrop-blur-sm`}>
                <span className="font-semibold capitalize">
                  {currentGeneration.status}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-2">
                <span>Progress</span>
                <span>{currentGeneration.progress}%</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-white h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${currentGeneration.progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Strategy Components */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Indicators */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-600" />
                  Technical Indicators
                </h4>
                <div className="space-y-2">
                  {currentGeneration.indicators.map((indicator, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-2"
                    >
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      {indicator}
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk Parameters */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-orange-600" />
                  Risk Parameters
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm bg-gray-50 rounded-lg p-2">
                    <span className="text-gray-600">Stop Loss</span>
                    <span className="font-semibold text-red-600">
                      {currentGeneration.risk_parameters.stop_loss}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm bg-gray-50 rounded-lg p-2">
                    <span className="text-gray-600">Take Profit</span>
                    <span className="font-semibold text-green-600">
                      {currentGeneration.risk_parameters.take_profit}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm bg-gray-50 rounded-lg p-2">
                    <span className="text-gray-600">Position Size</span>
                    <span className="font-semibold text-gray-900">
                      {currentGeneration.risk_parameters.position_size}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Entry Conditions */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                Entry Conditions
              </h4>
              <div className="space-y-2">
                {currentGeneration.entry_conditions.map((condition, idx) => (
                  <div 
                    key={idx}
                    className="text-sm text-gray-600 bg-green-50 border border-green-200 rounded-lg p-3"
                  >
                    {condition}
                  </div>
                ))}
              </div>
            </div>

            {/* Exit Conditions */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-red-600" />
                Exit Conditions
              </h4>
              <div className="space-y-2">
                {currentGeneration.exit_conditions.map((condition, idx) => (
                  <div 
                    key={idx}
                    className="text-sm text-gray-600 bg-red-50 border border-red-200 rounded-lg p-3"
                  >
                    {condition}
                  </div>
                ))}
              </div>
            </div>

            {/* Backtest Results */}
            {currentGeneration.backtest_results && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-purple-600" />
                  Backtest Results
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Total Trades</p>
                    <p className="text-lg font-bold text-gray-900">
                      {currentGeneration.backtest_results.total_trades}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Win Rate</p>
                    <p className="text-lg font-bold text-green-600">
                      {currentGeneration.backtest_results.win_rate.toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Profit Factor</p>
                    <p className="text-lg font-bold text-blue-600">
                      {currentGeneration.backtest_results.profit_factor.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Sharpe Ratio</p>
                    <p className="text-lg font-bold text-purple-600">
                      {currentGeneration.backtest_results.sharpe_ratio.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Max Drawdown</p>
                    <p className="text-lg font-bold text-red-600">
                      {currentGeneration.backtest_results.max_drawdown.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Strategies */}
      {recentStrategies.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-600" />
              Recently Generated Strategies
            </h3>
          </div>
          <div className="divide-y divide-gray-200">
            {recentStrategies.map((strategy) => (
              <div 
                key={strategy.id}
                className="p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(strategy.status)}
                    <div>
                      <h4 className="font-semibold text-gray-900">
                        {strategy.strategy_name}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(strategy.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {strategy.backtest_results && (
                      <div className="text-right">
                        <p className="text-xs text-gray-600">Win Rate</p>
                        <p className="text-sm font-bold text-green-600">
                          {strategy.backtest_results.win_rate.toFixed(1)}%
                        </p>
                      </div>
                    )}
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(strategy.status)}`}>
                      {strategy.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Activity State */}
      {!currentGeneration && recentStrategies.length === 0 && (
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4 animate-pulse" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Analyzing Markets...
          </h3>
          <p className="text-gray-500">
            The AI agent is analyzing market conditions to generate optimal trading strategies
          </p>
        </div>
      )}
    </div>
  );
};

export default StrategyGenerationDisplay;
