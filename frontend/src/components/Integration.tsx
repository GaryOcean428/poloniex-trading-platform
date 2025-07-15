import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Settings,
  ExternalLink
} from 'lucide-react';

 

interface IntegrationStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSync?: string;
  message?: string;
}

const Integration: React.FC = () => {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const checkIntegrationStatus = async (name: string) => {
    setRefreshing(name);

    // Simulate API call
    setTimeout(() => {
      const mockIntegrations: IntegrationStatus[] = [
        {
          name: 'Poloniex API',
          status: 'connected',
          lastSync: new Date().toLocaleTimeString(),
          message: 'Real-time data sync active'
        },
        {
          name: 'TradingView',
          status: 'connected',
          lastSync: new Date().toLocaleTimeString(),
          message: 'Chart data extraction active'
        },
        {
          name: 'Chrome Extension',
          status: 'disconnected',
          message: 'Extension not detected'
        }
      ];

      setIntegrations(mockIntegrations);
      setIsLoading(false);
      setRefreshing(null);
    }, 1000);
  };

  useEffect(() => {
    checkIntegrationStatus('all');
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <AlertTriangle className="h-5 w-5 text-red-500" />;
      default:
        return <XCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'connected':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Integration Status</h2>
          <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Integration Status</h2>
        <button
          onClick={() => checkIntegrationStatus('all')}
          disabled={refreshing === 'all'}
          className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
          title="Refresh all integrations"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing === 'all' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-4">
        {integrations.map((integration) => (
          <div
            key={integration.name}
            className={`p-4 rounded-lg border ${getStatusBg(integration.status)}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {getStatusIcon(integration.status)}
                <div className="ml-3">
                  <h3 className="font-medium text-gray-900">{integration.name}</h3>
                  <p className={`text-sm ${getStatusColor(integration.status)}`}>
                    {integration.message}
                  </p>
                </div>
              </div>

              <button
                onClick={() => checkIntegrationStatus(integration.name)}
                disabled={refreshing === integration.name}
                className="p-1 text-gray-400 hover:text-gray-600"
                title={`Refresh ${integration.name}`}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing === integration.name ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {integration.lastSync && (
              <div className="mt-2 text-xs text-gray-500">
                Last sync: {integration.lastSync}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start">
          <Settings className="h-5 w-5 text-blue-500 mt-0.5" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Setup Instructions</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>To enable all integrations:</p>
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>Install the Chrome extension from the Chrome Web Store</li>
                <li>Add your Poloniex API credentials in Settings</li>
                <li>Visit TradingView and enable the extension</li>
                <li>Grant necessary permissions when prompted</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <a
          href="https://docs.poloniex.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          View Documentation
        </a>
      </div>
    </div>
  );
};

export default Integration;
