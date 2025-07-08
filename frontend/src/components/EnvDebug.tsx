import React from 'react';

export const EnvDebug: React.FC = () => {
  const envVars = {
    // Check what the frontend is actually receiving
    API_KEY: import.meta.env.VITE_POLONIEX_API_KEY,
    API_SECRET: import.meta.env.VITE_POLONIEX_API_SECRET,
    API_URL: import.meta.env.VITE_API_URL,
    WS_URL: import.meta.env.VITE_WS_URL,
    FORCE_MOCK: import.meta.env.VITE_FORCE_MOCK_MODE,
    NODE_ENV: import.meta.env.MODE,
    IS_PROD: import.meta.env.PROD,
  };

  // Determine why mock mode is active
  const hasApiKey = !!(envVars.API_KEY && envVars.API_KEY.length > 10);
  const hasApiSecret = !!(envVars.API_SECRET && envVars.API_SECRET.length > 10);
  const forceMock = envVars.FORCE_MOCK === 'true';
  
  const isLiveMode = hasApiKey && hasApiSecret && !forceMock;

  return (
    <div style={{ 
      position: 'fixed', 
      top: '10px', 
      right: '10px', 
      background: '#1a1a1a', 
      color: '#fff', 
      padding: '15px', 
      borderRadius: '8px', 
      fontSize: '12px',
      zIndex: 9999,
      maxWidth: '400px',
      border: '1px solid #333'
    }}>
      <h3 style={{ margin: '0 0 10px 0', color: '#4a90e2' }}>🔍 Environment Debug</h3>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Mode: </strong>
        <span style={{ color: isLiveMode ? '#00ff00' : '#ff9800' }}>
          {isLiveMode ? '✅ LIVE' : '🧪 MOCK'}
        </span>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <strong>Why Mock Mode?</strong>
        <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
          {!hasApiKey && <li style={{ color: '#ff5252' }}>No API Key</li>}
          {!hasApiSecret && <li style={{ color: '#ff5252' }}>No API Secret</li>}
          {forceMock && <li style={{ color: '#ff5252' }}>Force Mock = true</li>}
          {isLiveMode && <li style={{ color: '#00ff00' }}>All conditions met!</li>}
        </ul>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>
          Environment Variables
        </summary>
        <pre style={{ 
          background: '#0a0a0a', 
          padding: '10px', 
          borderRadius: '4px', 
          overflow: 'auto',
          fontSize: '11px'
        }}>
{Object.entries(envVars).map(([key, value]) => {
  const displayValue = key.includes('SECRET') && value 
    ? value.substring(0, 10) + '...' 
    : value || 'NOT SET';
  return `${key}: ${displayValue}\n`;
}).join('')}
        </pre>
      </details>

      <button 
        onClick={() => window.location.reload()}
        style={{
          marginTop: '10px',
          padding: '5px 10px',
          background: '#4a90e2',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Reload Page
      </button>
    </div>
  );
};