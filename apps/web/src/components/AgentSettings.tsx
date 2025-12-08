/**
 * Agent Settings Component
 * 
 * Allows users to configure persistent agent behavior
 */

import React, { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { getAccessToken } from '@/utils/auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8765';

interface AgentSettingsData {
  runMode: 'never' | 'manual' | 'always';
  autoStartOnLogin: boolean;
  continueWhenLoggedOut: boolean;
  config: any;
}

const AgentSettings: React.FC = () => {
  const [settings, setSettings] = useState<AgentSettingsData>({
    runMode: 'manual',
    autoStartOnLogin: false,
    continueWhenLoggedOut: false,
    config: {}
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = getAccessToken();
      if (!token) {
        setError('Please log in to view settings');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_BASE}/api/agent/settings`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }

      const data = await response.json();
      setSettings(data.settings);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const token = getAccessToken();
      if (!token) {
        throw new Error('Please log in to save settings');
      }

      const response = await fetch(`${API_BASE}/api/agent/settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      setSuccess('Settings saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="h-6 w-6 text-blue-600" />
        <h3 className="text-lg font-semibold">Agent Persistence Settings</h3>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-2">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-green-800 text-sm">{success}</p>
        </div>
      )}

      {/* Run Mode */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Run Mode</label>
        <select
          value={settings.runMode}
          onChange={(e) => setSettings({ ...settings, runMode: e.target.value as any })}
          className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="never">Never - Disabled</option>
          <option value="manual">Manual - User controlled</option>
          <option value="always">Always - Run 24/7</option>
        </select>
        <div className="mt-2 text-sm text-gray-600">
          {settings.runMode === 'never' && (
            <p>⛔ Agent will never start automatically. You must start it manually each time.</p>
          )}
          {settings.runMode === 'manual' && (
            <p>🎮 Agent starts when you click Start, stops when you click Stop. Default behavior.</p>
          )}
          {settings.runMode === 'always' && (
            <p>🚀 Agent runs continuously 24/7, even when you're logged out. Requires API credentials.</p>
          )}
        </div>
      </div>

      {/* Auto-start on login */}
      <div className="mb-4">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoStartOnLogin}
            onChange={(e) => setSettings({ ...settings, autoStartOnLogin: e.target.checked })}
            disabled={settings.runMode === 'never'}
            className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
          />
          <div>
            <span className="text-sm font-medium">Auto-start agent when I log in</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Agent will start automatically when you log in to the platform
            </p>
          </div>
        </label>
      </div>

      {/* Continue when logged out */}
      <div className="mb-6">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.continueWhenLoggedOut}
            onChange={(e) => setSettings({ ...settings, continueWhenLoggedOut: e.target.checked })}
            disabled={settings.runMode !== 'always'}
            className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
          />
          <div>
            <span className="text-sm font-medium">Continue running when I log out</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Only available in "Always" mode. Agent keeps trading even when you're not logged in.
            </p>
          </div>
        </label>
      </div>

      {/* Warning for Always mode */}
      {settings.runMode === 'always' && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">Important: Always Mode</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Agent will trade 24/7 using your API keys</li>
                <li>Ensure you have proper risk management settings</li>
                <li>Monitor your account regularly</li>
                <li>You can stop the agent anytime from the dashboard</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={saveSettings}
        disabled={saving}
        className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
      >
        <Save className="h-5 w-5" />
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      {/* Info Section */}
      <div className="mt-6 pt-6 border-t">
        <h4 className="text-sm font-semibold mb-2">How It Works</h4>
        <div className="space-y-2 text-sm text-gray-600">
          <div>
            <strong className="text-gray-900">Never Mode:</strong> Agent is completely disabled. You must manually start it each time you want to trade.
          </div>
          <div>
            <strong className="text-gray-900">Manual Mode:</strong> Default behavior. Agent starts when you click "Start" and stops when you click "Stop" or log out.
          </div>
          <div>
            <strong className="text-gray-900">Always Mode:</strong> Agent runs continuously in the background, even when you're not logged in. Perfect for 24/7 automated trading.
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentSettings;
