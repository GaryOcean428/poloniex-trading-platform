import React, { useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface RiskStatus {
  currentDrawdown: number;
  currentPositions: number;
  dailyLoss: number;
  riskScore: number;
  alerts: string[];
}

export default function RiskMeter() {
  const [status, setStatus] = useState<RiskStatus>({
    currentDrawdown: 0,
    currentPositions: 0,
    dailyLoss: 0,
    riskScore: 25,
    alerts: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(
        `${API_BASE_URL}/api/risk/status`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        setStatus(response.data.status);
      }
      setLoading(false);
    } catch (_err) {
      // console.error('Error fetching risk status:', err);
      setLoading(false);
    }
  };

  const getRiskLevel = () => {
    if (status.riskScore < 30) return { label: 'Low', color: 'green', icon: CheckCircle };
    if (status.riskScore < 60) return { label: 'Medium', color: 'yellow', icon: Shield };
    return { label: 'High', color: 'red', icon: AlertTriangle };
  };

  const riskLevel = getRiskLevel();
  const RiskIcon = riskLevel.icon;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="h-24 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Risk Meter</h3>
        <RiskIcon className={`text-${riskLevel.color}-600`} size={24} />
      </div>

      {/* Risk Score Gauge */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Risk Level</span>
          <span className={`font-bold text-${riskLevel.color}-600`}>
            {riskLevel.label}
          </span>
        </div>
        
        {/* Gauge Bar */}
        <div className="relative h-8 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`absolute h-full transition-all duration-500 ${
              riskLevel.color === 'green' ? 'bg-green-500' :
              riskLevel.color === 'yellow' ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
            style={{ width: `${status.riskScore}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold text-gray-900">
              {status.riskScore}/100
            </span>
          </div>
        </div>
        
        {/* Scale Labels */}
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>Low Risk</span>
          <span>Medium</span>
          <span>High Risk</span>
        </div>
      </div>

      {/* Current Metrics */}
      <div className="space-y-3">
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-600">Current Drawdown</span>
          <span className={`font-semibold ${
            status.currentDrawdown < 5 ? 'text-green-600' :
            status.currentDrawdown < 10 ? 'text-yellow-600' :
            'text-red-600'
          }`}>
            {status.currentDrawdown.toFixed(2)}%
          </span>
        </div>

        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-600">Open Positions</span>
          <span className="font-semibold text-gray-900">
            {status.currentPositions}
          </span>
        </div>

        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-600">Daily Loss</span>
          <span className={`font-semibold ${
            status.dailyLoss < 2 ? 'text-green-600' :
            status.dailyLoss < 5 ? 'text-yellow-600' :
            'text-red-600'
          }`}>
            {status.dailyLoss.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Alerts */}
      {status.alerts && status.alerts.length > 0 && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={16} />
            <div className="text-sm text-red-800">
              <p className="font-medium mb-1">Risk Alerts</p>
              <ul className="space-y-1">
                {status.alerts.map((alert, idx) => (
                  <li key={idx}>• {alert}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Status Message */}
      {status.alerts.length === 0 && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-green-800">
            <CheckCircle size={16} className="text-green-600" />
            <span>All risk parameters within limits</span>
          </div>
        </div>
      )}
    </div>
  );
}
