import React, { useState, useEffect } from 'react';
import { Shield, Save, AlertTriangle, TrendingDown, Target } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface RiskSettingsData {
  maxDrawdown: number;
  maxPositionSize: number;
  maxConcurrentPositions: number;
  stopLoss: number;
  takeProfit: number;
  dailyLossLimit: number;
  maxLeverage: number;
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
}

const RISK_PRESETS: Record<string, Partial<RiskSettingsData>> = {
  conservative: {
    maxDrawdown: 10,
    maxPositionSize: 3,
    maxConcurrentPositions: 2,
    stopLoss: 1.5,
    takeProfit: 3,
    dailyLossLimit: 3,
    maxLeverage: 5,
    riskLevel: 'conservative'
  },
  moderate: {
    maxDrawdown: 15,
    maxPositionSize: 5,
    maxConcurrentPositions: 3,
    stopLoss: 2,
    takeProfit: 4,
    dailyLossLimit: 5,
    maxLeverage: 10,
    riskLevel: 'moderate'
  },
  aggressive: {
    maxDrawdown: 25,
    maxPositionSize: 10,
    maxConcurrentPositions: 5,
    stopLoss: 3,
    takeProfit: 6,
    dailyLossLimit: 10,
    maxLeverage: 20,
    riskLevel: 'aggressive'
  }
};

export default function RiskSettings() {
  const [settings, setSettings] = useState<RiskSettingsData>({
    maxDrawdown: 15,
    maxPositionSize: 5,
    maxConcurrentPositions: 3,
    stopLoss: 2,
    takeProfit: 4,
    dailyLossLimit: 5,
    maxLeverage: 10,
    riskLevel: 'moderate'
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(
        `${API_BASE_URL}/api/risk/settings`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success && response.data.settings) {
        setSettings(response.data.settings);
      }
      setLoading(false);
    } catch (_err) {
      // console.error('Error fetching risk settings:', err);
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage(null);
    
    try {
      const token = getAccessToken();
      await axios.put(
        `${API_BASE_URL}/api/risk/settings`,
        settings,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setMessage({ type: 'success', text: 'Risk settings saved successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage({ 
        type: 'error', 
        text: err.response?.data?.error || 'Failed to save settings' 
      });
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (preset: keyof typeof RISK_PRESETS) => {
    setSettings({ ...settings, ...RISK_PRESETS[preset] });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Shield size={32} />
          <h2 className="text-2xl font-bold">Risk Management</h2>
        </div>
        <p className="text-blue-100">
          Configure your risk parameters to protect your capital and manage exposure
        </p>
      </div>

      {/* Presets */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Quick Presets</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => applyPreset('conservative')}
            className={`p-4 rounded-lg border-2 transition-all ${
              settings.riskLevel === 'conservative'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-green-300'
            }`}
          >
            <div className="text-center">
              <Shield className="mx-auto mb-2 text-green-600" size={24} />
              <h4 className="font-semibold text-gray-900">Conservative</h4>
              <p className="text-sm text-gray-600 mt-1">Low risk, steady growth</p>
            </div>
          </button>

          <button
            onClick={() => applyPreset('moderate')}
            className={`p-4 rounded-lg border-2 transition-all ${
              settings.riskLevel === 'moderate'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300'
            }`}
          >
            <div className="text-center">
              <Target className="mx-auto mb-2 text-blue-600" size={24} />
              <h4 className="font-semibold text-gray-900">Moderate</h4>
              <p className="text-sm text-gray-600 mt-1">Balanced risk/reward</p>
            </div>
          </button>

          <button
            onClick={() => applyPreset('aggressive')}
            className={`p-4 rounded-lg border-2 transition-all ${
              settings.riskLevel === 'aggressive'
                ? 'border-red-500 bg-red-50'
                : 'border-gray-200 hover:border-red-300'
            }`}
          >
            <div className="text-center">
              <TrendingDown className="mx-auto mb-2 text-red-600" size={24} />
              <h4 className="font-semibold text-gray-900">Aggressive</h4>
              <p className="text-sm text-gray-600 mt-1">High risk, high reward</p>
            </div>
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-6 text-gray-900">Custom Settings</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Max Drawdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Drawdown (%)
            </label>
            <input
              type="number"
              value={settings.maxDrawdown}
              onChange={(e) => setSettings({...settings, maxDrawdown: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              max="50"
              step="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum portfolio decline before stopping trading
            </p>
          </div>

          {/* Max Position Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Position Size (%)
            </label>
            <input
              type="number"
              value={settings.maxPositionSize}
              onChange={(e) => setSettings({...settings, maxPositionSize: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              max="100"
              step="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum percentage of capital per position
            </p>
          </div>

          {/* Max Concurrent Positions */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Concurrent Positions
            </label>
            <input
              type="number"
              value={settings.maxConcurrentPositions}
              onChange={(e) => setSettings({...settings, maxConcurrentPositions: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              max="20"
              step="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum number of open positions at once
            </p>
          </div>

          {/* Stop Loss */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Stop Loss (%)
            </label>
            <input
              type="number"
              value={settings.stopLoss}
              onChange={(e) => setSettings({...settings, stopLoss: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="0.1"
              max="20"
              step="0.1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Automatic exit when position loses this percentage
            </p>
          </div>

          {/* Take Profit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Take Profit (%)
            </label>
            <input
              type="number"
              value={settings.takeProfit}
              onChange={(e) => setSettings({...settings, takeProfit: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="0.1"
              max="50"
              step="0.1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Automatic exit when position gains this percentage
            </p>
          </div>

          {/* Daily Loss Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Daily Loss Limit (%)
            </label>
            <input
              type="number"
              value={settings.dailyLossLimit}
              onChange={(e) => setSettings({...settings, dailyLossLimit: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              max="50"
              step="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Stop trading if daily loss exceeds this percentage
            </p>
          </div>

          {/* Max Leverage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Leverage
            </label>
            <input
              type="number"
              value={settings.maxLeverage}
              onChange={(e) => setSettings({...settings, maxLeverage: Number(e.target.value)})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              max="100"
              step="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum leverage for futures positions
            </p>
          </div>
        </div>
      </div>

      {/* Warning */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-yellow-800">
            <p className="font-medium mb-1">Important Risk Disclosure</p>
            <p>
              These settings help manage risk but do not guarantee profits or prevent losses. 
              Trading involves substantial risk. Only trade with capital you can afford to lose.
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              Saving...
            </>
          ) : (
            <>
              <Save size={20} />
              Save Risk Settings
            </>
          )}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg ${
          message.type === 'success' 
            ? 'bg-green-50 border border-green-200 text-green-800' 
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <p className="font-medium">{message.text}</p>
        </div>
      )}
    </div>
  );
}
