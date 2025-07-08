import React, { useState } from 'react';
import { Wifi, WifiOff, AlertCircle, Clock } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';

interface ConnectionHealthProps {
  className?: string;
}

const ConnectionHealth: React.FC<ConnectionHealthProps> = ({ className = '' }) => {
  const webSocket = useWebSocket();
  const [isExpanded, setIsExpanded] = useState(false);

  const getHealthStatus = () => {
    if (webSocket.isConnected) {
      return {
        icon: Wifi,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        status: 'Connected',
        description: 'Real-time data active'
      };
    } else if (webSocket.connectionState === 'connecting' || webSocket.connectionState === 'reconnecting') {
      return {
        icon: Clock,
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        status: 'Connecting',
        description: 'Establishing connection...'
      };
    } else {
      return {
        icon: WifiOff,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        status: 'Disconnected',
        description: 'Using mock data'
      };
    }
  };

  const formatUptime = (uptime: number) => {
    if (uptime < 60000) return `${Math.floor(uptime / 1000)}s`;
    if (uptime < 3600000) return `${Math.floor(uptime / 60000)}m`;
    return `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`;
  };

  const formatLatency = (latency: number | null) => {
    if (latency === null) return 'N/A';
    return `${Math.round(latency)}ms`;
  };

  const health = getHealthStatus();
  const HealthIcon = health.icon;

  return (
    <div className={`fixed bottom-4 right-4 z-40 ${className}`}>
      <div className={`${health.bgColor} ${health.borderColor} border rounded-lg shadow-lg transition-all duration-200`}>
        {/* Compact view */}
        <div 
          className={`p-3 cursor-pointer flex items-center space-x-2 ${isExpanded ? 'border-b border-current border-opacity-20' : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <HealthIcon className={`w-4 h-4 ${health.color}`} />
          <span className={`text-sm font-medium ${health.color}`}>
            {health.status}
          </span>
          <div className={`w-2 h-2 rounded-full ${webSocket.isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
        </div>

        {/* Expanded view */}
        {isExpanded && (
          <div className={`p-3 text-xs ${health.color}`}>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Status:</span>
                <span className="font-medium">{health.description}</span>
              </div>
              
              {webSocket.isConnected && (
                <>
                  <div className="flex justify-between">
                    <span>Uptime:</span>
                    <span className="font-mono">{formatUptime(webSocket.connectionHealth.uptime)}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span>Latency:</span>
                    <span className="font-mono">{formatLatency(webSocket.connectionHealth.latency)}</span>
                  </div>
                </>
              )}
              
              {webSocket.connectionHealth.reconnectAttempts > 0 && (
                <div className="flex justify-between">
                  <span>Reconnects:</span>
                  <span className="font-mono">{webSocket.connectionHealth.reconnectAttempts}</span>
                </div>
              )}

              <div className="flex justify-between">
                <span>State:</span>
                <span className="font-mono capitalize">{webSocket.connectionState}</span>
              </div>

              {webSocket.lastError && (
                <div className="pt-2 border-t border-current border-opacity-20">
                  <div className="flex items-start space-x-1">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span className="text-xs break-all">{webSocket.lastError}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionHealth;