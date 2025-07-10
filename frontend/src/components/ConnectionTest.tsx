import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

export const ConnectionTest: React.FC = () => {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'failed' | 'cors-blocked'>('checking');
  const [wsStatus, setWsStatus] = useState<'checking' | 'connected' | 'failed'>('checking');
  const [apiData, setApiData] = useState<{ status: string; timestamp: string } | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

  useEffect(() => {
    // Test API connection with better error handling
    const testApiConnection = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/health`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          mode: 'cors', // Explicitly set CORS mode
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        setApiStatus('connected');
        setApiData(data);
      } catch (err) {
        // Handle CORS and network errors more gracefully
        const error = err as Error;
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
          console.warn('API connection failed due to CORS policy or network error. This is expected in development mode.');
          setApiStatus('cors-blocked');
        } else {
          console.warn('API connection error:', error.message);
          setApiStatus('failed');
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
      if (import.meta.env.DEV) {
        console.info('WebSocket connected!');
      }
      setWsStatus('connected');
    });

    newSocket.on('connect_error', (err) => {
      if (err.message.includes('WebSocket is closed before the connection is established')) {
        console.warn('WebSocket connection failed due to server unavailability. This is expected in development mode.');
      } else {
        console.warn('WebSocket error:', err.message);
      }
      setWsStatus('failed');
    });

    return () => {
      newSocket.disconnect();
    };
  }, [apiUrl, wsUrl]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#4caf50';
      case 'failed': return '#f44336';
      case 'cors-blocked': return '#ff9800';
      default: return '#ff9800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'connected': return 'CONNECTED';
      case 'failed': return 'FAILED';
      case 'cors-blocked': return 'CORS BLOCKED';
      case 'checking': return 'CHECKING';
      default: return status.toUpperCase();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      left: '10px',
      background: '#1a1a1a',
      color: '#fff',
      padding: '15px',
      borderRadius: '8px',
      fontSize: '12px',
      zIndex: 9999,
      maxWidth: '350px',
      border: '1px solid #333'
    }}>
      <h3 style={{ margin: '0 0 15px 0', color: '#4a90e2' }}>
        🔌 Connection Status
      </h3>
      
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
  );
};