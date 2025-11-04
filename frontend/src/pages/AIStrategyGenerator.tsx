import React, { useState, useEffect } from 'react';
import { 
  generateStrategy, 
  generateStrategyVariations, 
  optimizeStrategy,
  analyzeMarket,
  checkLLMAvailability,
  type GeneratedStrategy,
  type StrategyGenerationRequest
} from '../services/llmStrategyService';
import { Card } from '../components/ui/Card';

const AIStrategyGenerator: React.FC = () => {
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedStrategy, setGeneratedStrategy] = useState<GeneratedStrategy | null>(null);
  const [strategyVariations, setStrategyVariations] = useState<GeneratedStrategy[]>([]);
  
  // Form state
  const [tradingPair, setTradingPair] = useState<string>('BTC-USDT');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [riskTolerance, setRiskTolerance] = useState<'low' | 'medium' | 'high'>('medium');
  const [marketTrend, setMarketTrend] = useState<string>('');
  const [variationCount, setVariationCount] = useState<number>(3);

  useEffect(() => {
    checkLLMAvailability().then(setIsAvailable);
  }, []);

  const handleGenerateStrategy = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const request: StrategyGenerationRequest = {
        tradingPair,
        timeframe,
        riskTolerance,
        marketConditions: marketTrend ? { trend: marketTrend } : undefined
      };
      
      const strategy = await generateStrategy(request);
      setGeneratedStrategy(strategy);
      setStrategyVariations([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateVariations = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const request: StrategyGenerationRequest = {
        tradingPair,
        timeframe,
        riskTolerance,
        marketConditions: marketTrend ? { trend: marketTrend } : undefined
      };
      
      const variations = await generateStrategyVariations({
        ...request,
        count: variationCount
      });
      
      setStrategyVariations(variations);
      setGeneratedStrategy(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeMarket = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const analysis = await analyzeMarket(tradingPair, timeframe);
      alert(`Market Analysis:\n\nTrend: ${analysis.trend}\nVolatility: ${analysis.volatility}\n\nRecommendations:\n${analysis.recommendations.join('\n')}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAvailable) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-8 text-center">
          <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
            AI Strategy Generator Unavailable
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            The AI strategy generation feature requires the ANTHROPIC_API_KEY to be configured.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Please contact your administrator to enable this feature.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          🤖 AI Strategy Generator
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Generate novel trading strategies powered by Claude AI
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <Card className="lg:col-span-1 p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
            Strategy Parameters
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">
                Trading Pair
              </label>
              <select
                value={tradingPair}
                onChange={(e) => setTradingPair(e.target.value)}
                className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="BTC-USDT">BTC-USDT</option>
                <option value="ETH-USDT">ETH-USDT</option>
                <option value="SOL-USDT">SOL-USDT</option>
                <option value="BNB-USDT">BNB-USDT</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">
                Timeframe
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="5m">5 minutes</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="4h">4 hours</option>
                <option value="1d">1 day</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">
                Risk Tolerance
              </label>
              <select
                value={riskTolerance}
                onChange={(e) => setRiskTolerance(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">
                Market Trend (Optional)
              </label>
              <input
                type="text"
                value={marketTrend}
                onChange={(e) => setMarketTrend(e.target.value)}
                placeholder="e.g., bullish, bearish, ranging"
                className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">
                Variation Count (1-5)
              </label>
              <input
                type="number"
                min="1"
                max="5"
                value={variationCount}
                onChange={(e) => setVariationCount(parseInt(e.target.value))}
                className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="space-y-2 pt-4">
              <button
                onClick={handleGenerateStrategy}
                disabled={isLoading}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
              >
                {isLoading ? 'Generating...' : 'Generate Single Strategy'}
              </button>
              
              <button
                onClick={handleGenerateVariations}
                disabled={isLoading}
                className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
              >
                {isLoading ? 'Generating...' : `Generate ${variationCount} Variations`}
              </button>
              
              <button
                onClick={handleAnalyzeMarket}
                disabled={isLoading}
                className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
              >
                {isLoading ? 'Analyzing...' : 'Analyze Market'}
              </button>
            </div>
          </div>
        </Card>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-6">
          {generatedStrategy && (
            <Card className="p-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                {generatedStrategy.name}
              </h2>
              
              <div className="mb-4">
                <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                  generatedStrategy.riskLevel === 'low' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                  generatedStrategy.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                  'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                }`}>
                  Risk: {generatedStrategy.riskLevel.toUpperCase()}
                </span>
              </div>

              <p className="text-gray-700 dark:text-gray-300 mb-4">
                {generatedStrategy.description}
              </p>

              <div className="mb-4">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">AI Reasoning:</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {generatedStrategy.reasoning}
                </p>
              </div>

              <div className="mb-4">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Strategy Code:</h3>
                <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto text-sm">
                  <code className="text-gray-900 dark:text-gray-100">{generatedStrategy.code}</code>
                </pre>
              </div>

              <div className="flex gap-2">
                <button className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                  Backtest Strategy
                </button>
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  Deploy Strategy
                </button>
              </div>
            </Card>
          )}

          {strategyVariations.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Strategy Variations ({strategyVariations.length})
              </h2>
              
              {strategyVariations.map((strategy, index) => (
                <Card key={index} className="p-6">
                  <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
                    {strategy.name}
                  </h3>
                  
                  <div className="mb-3">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                      strategy.riskLevel === 'low' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      strategy.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                      'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    }`}>
                      Risk: {strategy.riskLevel.toUpperCase()}
                    </span>
                  </div>

                  <p className="text-gray-700 dark:text-gray-300 mb-3 text-sm">
                    {strategy.description}
                  </p>

                  <details className="mb-3">
                    <summary className="cursor-pointer text-blue-600 dark:text-blue-400 text-sm">
                      View Code
                    </summary>
                    <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded-lg overflow-x-auto text-xs mt-2">
                      <code className="text-gray-900 dark:text-gray-100">{strategy.code}</code>
                    </pre>
                  </details>

                  <div className="flex gap-2">
                    <button className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm">
                      Backtest
                    </button>
                    <button className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
                      Deploy
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!generatedStrategy && strategyVariations.length === 0 && (
            <Card className="p-12 text-center">
              <div className="text-6xl mb-4">🤖</div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
                Ready to Generate AI Strategies
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Configure your parameters and click a button to generate trading strategies
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIStrategyGenerator;
