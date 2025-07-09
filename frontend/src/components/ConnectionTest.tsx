import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export const ConnectionTest: React.FC = () => {
  const [apiStatus, setApiStatus] = useState('checking');
  const [wsStatus, setWsStatus] = useState<'checking' | 'connected' | 'failed'>('checking');
  const [apiData, setApiData] = useState<{ status: string; timestamp: string } | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

  useEffect(() => {
    // Test API connection
    fetch(`${apiUrl}/api/health`)
      .then(res => res.json())
      .then(data => {
        setApiStatus('connected');
        setApiData(data);
      })
      .catch(err => {
        console.error('API Error:', err);
        setApiStatus('failed');
      });

    // Test WebSocket connection
    const newSocket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected!');
      setWsStatus('connected');
    });

    newSocket.on('connect_error', (err) => {
      console.error('WebSocket error:', err);
      setWsStatus('failed');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [apiUrl, wsUrl]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#4caf50';
      case 'failed': return '#f44336';
      default: return '#ff9800';
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
            {apiStatus.toUpperCase()}
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
            {wsStatus.toUpperCase()}
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