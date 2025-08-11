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
              // eslint-disable-next-line no-console
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
              // eslint-disable-next-line no-console
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
            // eslint-disable-next-line no-console
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
            // eslint-disable-next-line no-console
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
      newSocket.disconnect();
    };
  }, [apiUrl, wsUrl, addToast]);

  const getStatusColor = (status: string) => {
    switch (status)
    {
      case 'connected': return '#4caf50';
      case 'failed': return '#f44336';
      case 'cors-blocked': return '#ff9800';
      default: return '#ff9800';
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
        <div style={{
          position: 'fixed',
          bottom: '10px',
          left: '10px',
          background: '#1a1a1a',
          color: '#fff',
          padding: '15px',
          borderRadius: '8px',
          fontSize: '12px',
          zIndex: 40,
          maxWidth: '350px',
          border: '1px solid #333'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <h3 style={{ margin: '0 0 5px 0', color: '#4a90e2' }}>
              🔌 Connection Status
            </h3>
            <button
              onClick={() => setIsVisible(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#999',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Hide connection status"
            >
              ×
            </button>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>API Connection:</span>
              <span style={{ color: getStatusColor(apiStatus), fontWeight: 'bold' }}>
                {getStatusText(apiStatus)}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>
              {apiUrl}
            </div>
            {apiData && (
              <pre style={{
                background: '#0a0a0a',
                padding: '8px',
                borderRadius: '4px',
                fontSize: '11px',
                marginTop: '8px'
              }}>
                {JSON.stringify(apiData, null, 2)}
              </pre>
            )}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>WebSocket:</span>
              <span style={{ color: getStatusColor(wsStatus), fontWeight: 'bold' }}>
                {getStatusText(wsStatus)}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>
              {wsUrl}
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            style={{
              width: '100%',
              padding: '8px',
              background: '#4a90e2',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Refresh
          </button>
        </div>
      )}

      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          style={{
            position: 'fixed',
            bottom: '10px',
            left: '10px',
            background: '#1a1a1a',
            color: '#4a90e2',
            border: '1px solid #333',
            borderRadius: '4px',
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: '12px',
            zIndex: 40
          }}
          title="Show connection status"
        >
          🔌 Status
        </button>
      )}
    </>
  );
};
