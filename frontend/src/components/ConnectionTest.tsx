import { useAppStore } from '@/store';
import { getBackendUrl, getWebSocketUrl } from '@/utils/environment';
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export const ConnectionTest: React.FC = () => {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'failed' | 'cors-blocked'>('checking');
  const [wsStatus, setWsStatus] = useState<'checking' | 'connected' | 'failed'>('checking');
  const [apiData, setApiData] = useState<{ status: string; timestamp: string } | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  // Refs to track if we've already shown notifications for these errors
  const apiErrorNotifiedRef = useRef(false);
  const wsErrorNotifiedRef = useRef(false);
  const lastErrorTimeRef = useRef<{ api: number, ws: number }>({ api: 0, ws: 0 });

  const addToast = useAppStore(state => state.addToast);

  const apiUrl = (import.meta.env.VITE_API_URL as string) || getBackendUrl();
  const wsUrl = (import.meta.env.VITE_WS_URL as string) || getWebSocketUrl();

  useEffect(() => {
    // Test API connection with better error handling
    const testApiConnection = async () => {
      try
      {
        const url = `${apiUrl}/api/health`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          mode: 'cors', // Explicitly set CORS mode
        });

        const contentType = response.headers.get('content-type') || '';

        if (!response.ok)
        {
          let preview = '';
          try { preview = await response.text(); } catch (_e) { preview = ''; }
          throw new Error(`HTTP ${response.status}: ${response.statusText} (${url}) ${preview.slice(0, 200)}`);
        }

        if (!contentType.includes('application/json'))
        {
          const text = await response.text().catch(() => '');
          throw new Error(`Non-JSON response ${response.status} from ${url}: ${text.slice(0, 200)}`);
        }

        const data = await response.json();
        setApiStatus('connected');
        setApiData(data);
        apiErrorNotifiedRef.current = false; // Reset error notification flag on success
      } catch (err)
      {
        // Handle CORS and network errors more gracefully
        const error = err as Error;
        const now = Date.now();

        // Only show toast notification once every 30 seconds to avoid spam
        if (!apiErrorNotifiedRef.current || now - lastErrorTimeRef.current.api > 30000)
        {
          if (error.message.includes('CORS') || error.message.includes('Failed to fetch'))
          {
            if (import.meta.env.DEV)
            {
               
              // console.warn('API connection failed due to CORS policy or network error. This is expected in development mode.');
            }
            setApiStatus('cors-blocked');
            addToast({
              message: 'Backend API unavailable - using mock data (expected in development)',
              type: 'warning',
              dismissible: true
            });
          } else
          {
            if (import.meta.env.DEV)
            {
               
              // console.warn('API connection error:', error.message);
            }
            setApiStatus('failed');
            addToast({
              message: `API connection failed: ${error.message}`,
              type: 'error',
              dismissible: true
            });
          }

          apiErrorNotifiedRef.current = true;
          lastErrorTimeRef.current.api = now;
        } else
        {
          // Still update status but don't spam notifications
          if (error.message.includes('CORS') || error.message.includes('Failed to fetch'))
          {
            setApiStatus('cors-blocked');
          } else
          {
            setApiStatus('failed');
          }
        }
      }
    };

    testApiConnection();

    // Test WebSocket connection with better error handling
    const newSocket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
      timeout: 5000,
    });

    newSocket.on('connect', () => {
      if (import.meta.env.DEV)
      {
        // eslint-disable-next-line no-console
        console.info('WebSocket connected!');
      }
      setWsStatus('connected');
      wsErrorNotifiedRef.current = false; // Reset error notification flag on success
    });

    newSocket.on('connect_error', (err) => {
      const now = Date.now();

      // Only show toast notification once every 30 seconds to avoid spam
      if (!wsErrorNotifiedRef.current || now - lastErrorTimeRef.current.ws > 30000)
      {
        if (err.message.includes('WebSocket is closed before the connection is established'))
        {
          if (import.meta.env.DEV)
          {
             
            // console.warn('WebSocket connection failed due to server unavailability. This is expected in development mode.');
          }
          addToast({
            message: 'WebSocket unavailable - using mock data (expected in development)',
            type: 'warning',
            dismissible: true
          });
        } else
        {
          if (import.meta.env.DEV)
          {
             
            // console.warn('WebSocket error:', err.message);
          }
          addToast({
            message: `WebSocket error: ${err.message}`,
            type: 'error',
            dismissible: true
          });
        }

        wsErrorNotifiedRef.current = true;
        lastErrorTimeRef.current.ws = now;
      }

      setWsStatus('failed');
    });

    return () => {
      const anySocket = newSocket as unknown as { disconnect?: () => void; close?: () => void };
      if (typeof anySocket.disconnect === 'function') {
        anySocket.disconnect();
      } else if (typeof anySocket.close === 'function') {
        anySocket.close();
      }
    };
  }, [apiUrl, wsUrl, addToast]);

  const getStatusClass = (status: string) => {
    switch (status)
    {
      case 'connected': return 'connection-status-widget__status--connected';
      case 'failed': return 'connection-status-widget__status--failed';
      case 'cors-blocked': return 'connection-status-widget__status--warning';
      default: return 'connection-status-widget__status--warning';
    }
  };

  const getStatusText = (status: string) => {
    switch (status)
    {
      case 'connected': return 'CONNECTED';
      case 'failed': return 'FAILED';
      case 'cors-blocked': return 'CORS BLOCKED';
      case 'checking': return 'CHECKING';
      default: return status.toUpperCase();
    }
  };

  return (
    <>
      {isVisible && (
        <div className="connection-status-widget">
          <div className="connection-status-widget__header">
            <h3 className="connection-status-widget__title">
              🔌 Connection Status
            </h3>
            <button
              onClick={() => setIsVisible(false)}
              className="connection-status-widget__close-btn"
              title="Hide connection status"
            >
              ×
            </button>
          </div>

          <div className="connection-status-widget__section">
            <div className="connection-status-widget__row">
              <span>API Connection:</span>
              <span className={`connection-status-widget__status ${getStatusClass(apiStatus)}`}>
                {getStatusText(apiStatus)}
              </span>
            </div>
            <div className="connection-status-widget__url">
              {apiUrl}
            </div>
            {apiData && (
              <pre className="connection-status-widget__pre">
                {JSON.stringify(apiData, null, 2)}
              </pre>
            )}
          </div>

          <div className="connection-status-widget__section">
            <div className="connection-status-widget__row">
              <span>WebSocket:</span>
              <span className={`connection-status-widget__status ${getStatusClass(wsStatus)}`}>
                {getStatusText(wsStatus)}
              </span>
            </div>
            <div className="connection-status-widget__url">
              {wsUrl}
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="connection-status-widget__refresh-btn"
          >
            Refresh
          </button>
        </div>
      )}

      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          className="connection-status-widget__toggle-btn"
          title="Show connection status"
        >
          🔌 Status
        </button>
      )}
    </>
  );
};
