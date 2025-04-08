import React, { useState } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { Card, CardHeader, CardBody, CardFooter, Button, Input, Switch, Select, Label } from '@/components/ui';

const TradingSettings: React.FC = () => {
  const { 
    leverage, 
    riskPerTrade, 
    stopLossPercent, 
    takeProfitPercent, 
    trailingStopPercent,
    autoTradingEnabled,
    updateSettings
  } = useSettings();

  const handleLeverageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ leverage: Number(e.target.value) });
  };

  const handleRiskChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (value >= 0.1 && value <= 10) {
      updateSettings({ riskPerTrade: value });
    }
  };

  const handleStopLossChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (value >= 0.5 && value <= 20) {
      updateSettings({ stopLossPercent: value });
    }
  };

  const handleTakeProfitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (value >= 0.5 && value <= 50) {
      updateSettings({ takeProfitPercent: value });
    }
  };

  const handleTrailingStopChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (value >= 0.1 && value <= 10) {
      updateSettings({ trailingStopPercent: value });
    }
  };

  const toggleAutoTrading = () => {
    updateSettings({ autoTradingEnabled: !autoTradingEnabled });
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <h3 className="text-lg font-medium">Trading Settings</h3>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <Label htmlFor="leverage">Leverage</Label>
            <Select 
              id="leverage" 
              value={leverage.toString()} 
              onChange={handleLeverageChange}
              className="w-full"
            >
              <option value="1">1x (No Leverage)</option>
              <option value="2">2x</option>
              <option value="3">3x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
              <option value="20">20x</option>
            </Select>
            <p className="text-xs text-gray-500 mt-1">
              Higher leverage increases both potential profits and risks.
            </p>
          </div>

          <div>
            <Label htmlFor="riskPerTrade">Risk Per Trade (%)</Label>
            <Input
              id="riskPerTrade"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={riskPerTrade}
              onChange={handleRiskChange}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Percentage of your account balance to risk on each trade.
            </p>
          </div>

          <div>
            <Label htmlFor="stopLoss">Stop Loss (%)</Label>
            <Input
              id="stopLoss"
              type="number"
              min="0.5"
              max="20"
              step="0.5"
              value={stopLossPercent}
              onChange={handleStopLossChange}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Automatically close position if price moves against you by this percentage.
            </p>
          </div>

          <div>
            <Label htmlFor="takeProfit">Take Profit (%)</Label>
            <Input
              id="takeProfit"
              type="number"
              min="0.5"
              max="50"
              step="0.5"
              value={takeProfitPercent}
              onChange={handleTakeProfitChange}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Automatically close position if price moves in your favor by this percentage.
            </p>
          </div>

          <div>
            <Label htmlFor="trailingStop">Trailing Stop (%)</Label>
            <Input
              id="trailingStop"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={trailingStopPercent}
              onChange={handleTrailingStopChange}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Trailing stop follows price movement to lock in profits.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="autoTrading">Automated Trading</Label>
              <p className="text-xs text-gray-500">
                Enable automated trading based on your strategies.
              </p>
            </div>
            <Switch
              id="autoTrading"
              checked={autoTradingEnabled}
              onCheckedChange={toggleAutoTrading}
            />
          </div>
        </div>
      </CardBody>
      <CardFooter>
        <p className="text-xs text-gray-500">
          These settings will be applied to all new trades. Existing trades will not be affected.
        </p>
      </CardFooter>
    </Card>
  );
};

export default TradingSettings;
