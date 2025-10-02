import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  Database, 
  Globe, 
  Info, 
  RefreshCw,
  Server,
  Wifi,
  ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { logger } from '@shared/logger';

interface StatusNotification {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  details: string[];
  dismissible: boolean;
  actionUrl?: string;
}

interface StatusData {
  timestamp: string;
  environment: string;
  services: {
    api: {
      status: string;
      uptime: number;
      version: string;
    };
    database: {
      status: string;
      lastCheck: string;
    };
    websocket: {
      status: string;
      connections: number;
    };
  };
  features: {
    liveTradingEnabled: boolean;
    mockMode: boolean;
    extensionSupported: boolean;
    webSocketConnected: boolean;
  };
  notifications: StatusNotification[];
}

const Status: React.FC = () => {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load dismissed notifications from localStorage
    const dismissed = localStorage.getItem('dismissedStatusNotifications');
    if (dismissed) {
      setDismissedNotifications(new Set(JSON.parse(dismissed)));
    }
    
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/status');
      if (!response.ok) {
        const errorMessage = response.status === 404 
          ? 'Status endpoint not found' 
          : `Server error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }
      const data = await response.json();
      setStatusData(data);
      setError(null);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Network connection failed - check if server is running');
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  const dismissNotification = (id: string) => {
    const newDismissed = new Set(dismissedNotifications);
    newDismissed.add(id);
    setDismissedNotifications(newDismissed);
    try {
      localStorage.setItem('dismissedStatusNotifications', JSON.stringify([...newDismissed]));
    } catch (error) {
      logger.warn('Failed to save dismissed notifications to localStorage', {
        component: 'Status',
        action: 'dismiss_notification',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'error':
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <Info className="w-5 h-5 text-text-secondary" />;
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'error':
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <Info className="w-5 h-5 text-brand-cyan" />;
    }
  };

  const getNotificationBgColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
            <h2 className="text-lg font-semibold text-red-800">Error Loading Status</h2>
          </div>
          <p className="text-red-700 mt-2">{error}</p>
          <button
            onClick={fetchStatus}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!statusData) {
    return null;
  }

  const visibleNotifications = (statusData.notifications || []).filter(
    notification => !dismissedNotifications.has(notification.id)
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">System Status</h1>
          <p className="text-text-secondary mt-1">
            Last updated: {new Date(statusData.timestamp).toLocaleString()}
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {/* Status Notifications */}
      {visibleNotifications.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-text-primary">Current Notices</h2>
          {visibleNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`border rounded-lg p-4 ${getNotificationBgColor(notification.type)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  {getNotificationIcon(notification.type)}
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-text-primary">
                      {notification.title}
                    </h3>
                    <p className="text-sm text-gray-700 mt-1">
                      {notification.message}
                    </p>
                    {notification.details.length > 0 && (
                      <ul className="text-sm text-text-secondary mt-2 space-y-1">
                        {notification.details.map((detail, index) => (
                          <li key={index} className="flex items-center space-x-2">
                            <span className="w-1 h-1 bg-current rounded-full"></span>
                            <span>{detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {notification.actionUrl && (
                      <Link
                        to={notification.actionUrl}
                        className="inline-flex items-center text-sm text-brand-cyan hover:text-brand-cyan/80 mt-2"
                      >
                        View Details
                        <ExternalLink className="w-4 h-4 ml-1" />
                      </Link>
                    )}
                  </div>
                </div>
                {notification.dismissible && (
                  <button
                    onClick={() => dismissNotification(notification.id)}
                    className="text-text-muted hover:text-text-secondary transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Services Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6 shadow-elev-1">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Server className="w-6 h-6 text-text-secondary mr-2" />
              <h3 className="text-lg font-semibold">API Server</h3>
            </div>
            {getStatusIcon(statusData.services.api.status)}
          </div>
          <div className="space-y-2 text-sm text-text-secondary">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="capitalize">{statusData.services.api.status}</span>
            </div>
            <div className="flex justify-between">
              <span>Uptime:</span>
              <span>{formatUptime(statusData.services.api.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span>Version:</span>
              <span>{statusData.services.api.version}</span>
            </div>
          </div>
        </div>

        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6 shadow-elev-1">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Database className="w-6 h-6 text-gray-600 mr-2" />
              <h3 className="text-lg font-semibold">Database</h3>
            </div>
            {getStatusIcon(statusData.services.database.status)}
          </div>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="capitalize">{statusData.services.database.status}</span>
            </div>
            <div className="flex justify-between">
              <span>Last Check:</span>
              <span>{new Date(statusData.services.database.lastCheck).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6 shadow-elev-1">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Wifi className="w-6 h-6 text-gray-600 mr-2" />
              <h3 className="text-lg font-semibold">WebSocket</h3>
            </div>
            {getStatusIcon(statusData.services.websocket.status)}
          </div>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="capitalize">{statusData.services.websocket.status}</span>
            </div>
            <div className="flex justify-between">
              <span>Connections:</span>
              <span>{statusData.services.websocket.connections}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Status */}
      <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6 shadow-elev-1">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Activity className="w-6 h-6 text-gray-600 mr-2" />
          Feature Status
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-md">
            <span className="text-sm font-medium">Live Trading</span>
            {statusData.features.liveTradingEnabled ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            )}
          </div>
          <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-md">
            <span className="text-sm font-medium">Mock Mode</span>
            {statusData.features.mockMode ? (
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            )}
          </div>
          <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-md">
            <span className="text-sm font-medium">Extension Support</span>
            {statusData.features.extensionSupported ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            )}
          </div>
          <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-md">
            <span className="text-sm font-medium">WebSocket</span>
            {statusData.features.webSocketConnected ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            )}
          </div>
        </div>
      </div>

      {/* Environment Information */}
      <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6 shadow-elev-1">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Globe className="w-6 h-6 text-gray-600 mr-2" />
          Environment Information
        </h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Environment:</span>
            <span className="capitalize font-medium">{statusData.environment}</span>
          </div>
          <div className="flex justify-between">
            <span>Last Updated:</span>
            <span>{new Date(statusData.timestamp).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Status;
