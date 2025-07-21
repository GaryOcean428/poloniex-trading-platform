import { X } from 'lucide-react';
import React, { useState } from 'react';
import { useTradingContext } from '../../hooks/useTradingContext';
import { Strategy, StrategyType, StrategyParameters } from '../../types';

interface NewStrategyFormProps {
  onClose: () => void;
}

const NewStrategyForm: React.FC<NewStrategyFormProps> = ({ onClose }) => {
  const { addStrategy } = useTradingContext();
  const [name, setName] = useState('');
  const [type, setType] = useState<StrategyType>(StrategyType.MA_CROSSOVER);
  const [pair, setPair] = useState('BTC-USDT');

  // MA Crossover parameters
  const [shortPeriod, setShortPeriod] = useState(10);
  const [longPeriod, setLongPeriod] = useState(50);

  // RSI parameters
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [overbought, setOverbought] = useState(70);
  const [oversold, setOversold] = useState(30);

  // Breakout parameters
  const [lookbackPeriod, setLookbackPeriod] = useState(24);
  const [breakoutThreshold, setBreakoutThreshold] = useState(2.5);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let parameters: Record<string, string | number> = { pair };

    switch (type)
    {
      case StrategyType.MA_CROSSOVER:
        parameters = {
          ...parameters,
          shortPeriod,
          longPeriod
        };
        break;
      case StrategyType.RSI:
        parameters = {
          ...parameters,
          period: rsiPeriod,
          overbought,
          oversold
        };
        break;
      case StrategyType.BREAKOUT:
        parameters = {
          ...parameters,
          lookbackPeriod,
          breakoutThreshold
        };
        break;
    }

    const newStrategy: Strategy = {
      id: Date.now().toString(),
      name,
      type,
      parameters: parameters as unknown as StrategyParameters,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      performance: {
        totalPnL: 0,
        winRate: 0,
        tradesCount: 0
      }
    };

    addStrategy(newStrategy);
    onClose();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Create New Strategy</h2>
        <button
          className="p-1.5 rounded-md bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          onClick={onClose}
          aria-label="Close form"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700">Strategy Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full input"
              placeholder="My Trading Strategy"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700">Strategy Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as StrategyType)}
                className="mt-1 block w-full select"
                title="Select strategy type"
              >
                <option value={StrategyType.MA_CROSSOVER}>Moving Average Crossover</option>
                <option value={StrategyType.RSI}>RSI</option>
                <option value={StrategyType.BREAKOUT}>Breakout</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700">Trading Pair</label>
              <select
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                className="mt-1 block w-full select"
                title="Select trading pair"
              >
                <option value="BTC-USDT">BTC-USDT</option>
                <option value="ETH-USDT">ETH-USDT</option>
                <option value="SOL-USDT">SOL-USDT</option>
              </select>
            </div>
          </div>

          {type === StrategyType.MA_CROSSOVER && (
            <div className="bg-blue-50 p-4 rounded-md">
              <h3 className="font-medium mb-3">Moving Average Crossover Parameters</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Short Period</label>
                  <input
                    type="number"
                    value={shortPeriod}
                    onChange={(e) => setShortPeriod(parseInt(e.target.value))}
                    className="mt-1 block w-full input"
                    min="1"
                    max={longPeriod - 1}
                    title="Short period for moving average"
                    placeholder="10"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Long Period</label>
                  <input
                    type="number"
                    value={longPeriod}
                    onChange={(e) => setLongPeriod(parseInt(e.target.value))}
                    className="mt-1 block w-full input"
                    min={shortPeriod + 1}
                    title="Long period for moving average"
                    placeholder="50"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {type === StrategyType.RSI && (
            <div className="bg-purple-50 p-4 rounded-md">
              <h3 className="font-medium mb-3">RSI Parameters</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Period</label>
                  <input
                    type="number"
                    value={rsiPeriod}
                    onChange={(e) => setRsiPeriod(parseInt(e.target.value))}
                    className="mt-1 block w-full input"
                    min="1"
                    title="RSI calculation period"
                    placeholder="14"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Overbought</label>
                  <input
                    type="number"
                    value={overbought}
                    onChange={(e) => setOverbought(parseInt(e.target.value))}
                    className="mt-1 block w-full input"
                    min={oversold + 1}
                    max="100"
                    title="Overbought threshold"
                    placeholder="70"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Oversold</label>
                  <input
                    type="number"
                    value={oversold}
                    onChange={(e) => setOversold(parseInt(e.target.value))}
                    className="mt-1 block w-full input"
                    min="0"
                    max={overbought - 1}
                    title="Oversold threshold"
                    placeholder="30"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {type === StrategyType.BREAKOUT && (
            <div className="bg-orange-50 p-4 rounded-md">
              <h3 className="font-medium mb-3">Breakout Parameters</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Lookback Period</label>
                  <input
                    type="number"
                    value={lookbackPeriod}
                    onChange={(e) => setLookbackPeriod(parseInt(e.target.value))}
                    className="mt-1 block w-full input"
                    min="1"
                    title="Lookback period for breakout calculation"
                    placeholder="24"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Breakout Threshold (%)</label>
                  <input
                    type="number"
                    value={breakoutThreshold}
                    onChange={(e) => setBreakoutThreshold(parseFloat(e.target.value))}
                    className="mt-1 block w-full input"
                    min="0.1"
                    step="0.1"
                    title="Breakout threshold percentage"
                    placeholder="2.5"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              Create Strategy
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default NewStrategyForm;
