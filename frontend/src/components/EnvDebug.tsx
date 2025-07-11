import React, { useState, useEffect } from 'react';

export const EnvDebug: React.FC = () => {
  const [isVisible, setIsVisible] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);

  // Load dismissed state from localStorage
  useEffect(() => {
    const dismissed = localStorage.getItem('envDebug_dismissed') === 'true';
    const minimized = localStorage.getItem('envDebug_minimized') === 'true';
    setIsVisible(!dismissed);
    setIsMinimized(minimized);
  }, []);

  // Handle dismiss
  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('envDebug_dismissed', 'true');
  };

  // Handle minimize/restore
  const handleToggleMinimize = () => {
    const newMinimized = !isMinimized;
    setIsMinimized(newMinimized);
    localStorage.setItem('envDebug_minimized', newMinimized.toString());
  };

  // Handle show again
  const handleShowAgain = () => {
    setIsVisible(true);
    localStorage.setItem('envDebug_dismissed', 'false');
  };

  // Show a small restore button if dismissed
  if (!isVisible) {
    return (
      <button
        onClick={handleShowAgain}
        style={{
          position: 'fixed',
          top: '10px',
          right: '10px',
          background: '#4a90e2',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          padding: '5px 8px',
          fontSize: '11px',
          cursor: 'pointer',
          zIndex: 9999,
          opacity: 0.7
        }}
        title="Show environment debug info"
      >
        🔍
      </button>
    );
  }
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
      padding: isMinimized ? '10px' : '15px', 
      borderRadius: '8px', 
      fontSize: '12px',
      zIndex: 9999,
      maxWidth: isMinimized ? '200px' : '400px',
      border: '1px solid #333',
      transition: 'all 0.3s ease'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: isMinimized ? '0' : '10px'
      }}>
        <h3 style={{ margin: '0', color: '#4a90e2', fontSize: isMinimized ? '11px' : '12px' }}>
          🔍 Environment Debug
        </h3>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={handleToggleMinimize}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ccc',
              cursor: 'pointer',
              padding: '2px 5px',
              fontSize: '12px'
            }}
            title={isMinimized ? "Expand" : "Minimize"}
          >
            {isMinimized ? '⬆️' : '⬇️'}
          </button>
          <button
            onClick={handleDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ccc',
              cursor: 'pointer',
              padding: '2px 5px',
              fontSize: '12px'
            }}
            title="Dismiss"
          >
            ✖️
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
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
        </>
      )}

      {isMinimized && (
        <div style={{ fontSize: '10px', color: '#ccc' }}>
          Mode: <span style={{ color: isLiveMode ? '#00ff00' : '#ff9800' }}>
            {isLiveMode ? 'LIVE' : 'MOCK'}
          </span>
        </div>
      )}
    </div>
  );
};