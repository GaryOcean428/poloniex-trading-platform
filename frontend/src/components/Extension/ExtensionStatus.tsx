import { CheckCircle, RefreshCw, Shield, Signal, XCircle } from 'lucide-react';
import React, { useEffect, useState } from 'react';

/* eslint-disable no-console */

interface ExtensionStatusProps {
  onRefreshRequest?: () => void;
}

interface ExtensionResponse {
  status: string;
  connected: boolean;
  version?: string;
  lastUpdate?: string;
}

const ExtensionStatus: React.FC<ExtensionStatusProps> = ({ onRefreshRequest }) => {
  const [status, setStatus] = useState<string>('Checking...');
  const [connected, setConnected] = useState<boolean>(false);
  const [version, setVersion] = useState<string>('Unknown');
  const [lastUpdate, setLastUpdate] = useState<string>('Never');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const checkExtensionStatus = async () => {
    setIsLoading(true);

    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage)
    {
      try
      {
        // Extension ID will need to be updated with your actual extension ID
        const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje';

        chrome.runtime.sendMessage(
          extensionId,
          { type: 'STATUS_CHECK' },
          (response: ExtensionResponse) => {
            if (response)
            {
              setStatus(response.status);
              setConnected(response.connected);
              setVersion(response.version || 'Unknown');
              setLastUpdate(response.lastUpdate || 'Just now');
            } else
            {
              setStatus('Not responding');
              setConnected(false);
            }
            setIsLoading(false);
          }
        );
      } catch (error)
      {
        console.error('Error checking extension status:', error);
        setStatus('Error connecting');
        setConnected(false);
        setIsLoading(false);
      }
    } else
    {
      setStatus('Extension not detected');
      setConnected(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkExtensionStatus();

    // Set up periodic status checks
    const interval = setInterval(() => {
      checkExtensionStatus();
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = () => {
    if (isLoading)
    {
      return <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />;
    }

    if (connected)
    {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }

    return <XCircle className="h-5 w-5 text-red-500" />;
  };

  const getStatusColor = () => {
    if (isLoading) return 'text-blue-600';
    if (connected) return 'text-green-600';
    return 'text-red-600';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg flex items-center">
          <Shield className="h-5 w-5 mr-2 text-blue-500" />
          Extension Status
        </h3>
        <button
          onClick={() => {
            if (onRefreshRequest) {
              onRefreshRequest();
            } else {
              checkExtensionStatus();
            }
          }}
          disabled={isLoading}
          className="p-1.5 rounded hover:bg-neutral-100 disabled:opacity-50"
          title="Refresh status"
          aria-label="Refresh extension status"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className={`p-4 rounded-lg border ${connected ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center">
          {getStatusIcon()}
          <div className="ml-3">
            <p className={`font-medium ${getStatusColor()}`}>{status}</p>
            <p className="text-sm text-neutral-600">
              {connected ? 'Extension connected and ready' : 'Extension not connected'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="bg-neutral-50 p-3 rounded">
          <div className="flex items-center mb-1">
            <Signal className="h-4 w-4 text-neutral-500 mr-1" />
            <span className="font-medium">Version</span>
          </div>
          <span className="text-neutral-600">{version}</span>
        </div>

        <div className="bg-neutral-50 p-3 rounded">
          <div className="flex items-center mb-1">
            <RefreshCw className="h-4 w-4 text-neutral-500 mr-1" />
            <span className="font-medium">Last Update</span>
          </div>
          <span className="text-neutral-600">{lastUpdate}</span>
        </div>
      </div>

      {!connected && (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <Shield className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                Extension Not Connected
              </h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>
                  Make sure the Chrome extension is installed and enabled. You may need to:
                </p>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>Install the extension from the Chrome Web Store</li>
                  <li>Enable the extension in Chrome settings</li>
                  <li>Visit TradingView to activate the extension</li>
                  <li>Check that the extension has the necessary permissions</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExtensionStatus;
