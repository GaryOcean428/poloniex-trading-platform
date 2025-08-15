import React, { useState } from 'react';
import { Strategy } from '@shared/types';
import { automatedTrading } from '../../services/automatedTrading';
import { Play, Pause, Settings, AlertTriangle } from 'lucide-react';

interface StrategyAutomationProps {
  strategy: Strategy;
}

const StrategyAutomation: React.FC<StrategyAutomationProps> = ({ strategy }) => {
  const [isAutomated, setIsAutomated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    maxPositions: 3,
    maxLeverage: 5,
    riskPerTrade: 2,
    stopLossPercent: 2,
    takeProfitPercent: 4,
    trailingStopPercent: 1
  });

  const handleToggleAutomation = () => {
    if (isAutomated) {
      automatedTrading.removeStrategy(strategy.id);
      automatedTrading.stop();
    } else {
      automatedTrading.updateConfig(config);
      automatedTrading.addStrategy(strategy);
      automatedTrading.start();
    }
    setIsAutomated(!isAutomated);
  };

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Strategy Automation</h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 text-neutral-500 hover:text-neutral-700 rounded-md hover:bg-neutral-100"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            onClick={handleToggleAutomation}
            className={`flex items-center px-3 py-2 rounded-md ${
              isAutomated
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {isAutomated ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Stop Automation
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Automation
              </>
            )}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="space-y-4">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3">
            <div className="flex">
              <AlertTriangle className="h-5 w-5 text-yellow-400 mr-2" />
              <p className="text-sm text-yellow-700">
                Automated trading will execute real trades with real funds. Make sure
                to configure your risk parameters carefully.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Max Positions
              </label>
              <input
                type="number"
                value={config.maxPositions}
                onChange={(e) => setConfig({ ...config, maxPositions: parseInt(e.target.value) })}
                className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Max Leverage
              </label>
              <input
                type="number"
                value={config.maxLeverage}
                onChange={(e) => setConfig({ ...config, maxLeverage: parseInt(e.target.value) })}
                className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Risk Per Trade (%)
              </label>
              <input
                type="number"
                value={config.riskPerTrade}
                onChange={(e) => setConfig({ ...config, riskPerTrade: parseFloat(e.target.value) })}
                className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Stop Loss (%)
              </label>
              <input
                type="number"
                value={config.stopLossPercent}
                onChange={(e) => setConfig({ ...config, stopLossPercent: parseFloat(e.target.value) })}
                className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Take Profit (%)
              </label>
              <input
                type="number"
                value={config.takeProfitPercent}
                onChange={(e) => setConfig({ ...config, takeProfitPercent: parseFloat(e.target.value) })}
                className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Trailing Stop (%)
              </label>
              <input
                type="number"
                value={config.trailingStopPercent}
                onChange={(e) => setConfig({ ...config, trailingStopPercent: parseFloat(e.target.value) })}
                className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyAutomation;