import React from 'react';
import { ConnectionState } from '../services/websocketService';
import { AlertCircle, Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';

interface ConnectionStatusProps {
  connectionState: ConnectionState;
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
  onManualReconnect?: () => void;
  showDetails?: boolean;
  className?: string;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  connectionState,
  reconnectAttempts = 0,
  maxReconnectAttempts = 10,
  onManualReconnect,
  showDetails = false,
  className = ''
}) => {
  // Get status details based on connection state
  const getStatusDetails = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
          text: 'Connected',
          description: 'Real-time data connection established',
          color: 'text-green-500',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-500'
        };
      case ConnectionState.CONNECTING:
        return {
          icon: <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />,
          text: 'Connecting',
          description: 'Establishing connection...',
          color: 'text-blue-500',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-500'
        };
      case ConnectionState.RECONNECTING:
        return {
          icon: <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />,
          text: 'Reconnecting',
          description: `Attempt ${reconnectAttempts}/${maxReconnectAttempts}`,
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-500'
        };
      case ConnectionState.DISCONNECTED:
        return {
          icon: <WifiOff className="h-4 w-4 text-red-500" />,
          text: 'Disconnected',
          description: 'Connection lost, will attempt to reconnect',
          color: 'text-red-500',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-500'
        };
      case ConnectionState.FAILED:
        return {
          icon: <AlertCircle className="h-4 w-4 text-red-500" />,
          text: 'Connection Failed',
          description: 'Unable to establish connection, using offline data',
          color: 'text-red-500',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-500'
        };
      default:
        return {
          icon: <Wifi className="h-4 w-4 text-gray-500" />,
          text: 'Unknown',
          description: 'Connection status unknown',
          color: 'text-gray-500',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-500'
        };
    }
  };

  const status = getStatusDetails();

  // Compact version (just icon and text)
  if (!showDetails) {
    return (
      <div className={`flex items-center space-x-1 ${className}`}>
        {status.icon}
        <span className={`text-xs font-medium ${status.color}`}>{status.text}</span>
      </div>
    );
  }

  // Detailed version with description and reconnect button
  return (
    <div className={`rounded-md p-3 ${status.bgColor} border ${status.borderColor} ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {status.icon}
          <div>
            <h4 className={`font-medium ${status.color}`}>{status.text}</h4>
            <p className="text-xs text-gray-600">{status.description}</p>
          </div>
        </div>
        
        {(connectionState === ConnectionState.DISCONNECTED || 
          connectionState === ConnectionState.FAILED) && 
          onManualReconnect && (
          <button
            onClick={onManualReconnect}
            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
};

export default ConnectionStatus;
