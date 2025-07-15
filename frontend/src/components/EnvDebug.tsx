import React, { useState, useEffect } from 'react';
import './EnvDebug.css';

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
        className="env-debug-restore"
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

  if (isMinimized) {
    return (
      <div className="env-debug-minimized">
        <span className="env-debug-mode-indicator">
          Mode: <span className={isLiveMode ? 'status-connected' : 'status-disconnected'}>
            {isLiveMode ? 'LIVE' : 'MOCK'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="env-debug">
      <div className="env-debug-header">
        <h3 className="env-debug-title">🔍 Environment Debug</h3>
        <div className="env-debug-actions">
          <button
            onClick={handleToggleMinimize}
            className="env-debug-button"
            title="Minimize"
          >
            {isMinimized ? '⬆️' : '⬇️'}
          </button>
          <button
            onClick={handleDismiss}
            className="env-debug-button danger"
            title="Dismiss"
          >
            ✖️
          </button>
        </div>
      </div>
      
      <div className="env-debug-content">
        {/* Environment Mode */}
        <div className="env-debug-section">
          <div>Environment Mode:</div>
          <div>
            <span className={`env-debug-mode ${isLiveMode ? 'status-connected' : 'status-disconnected'}`}>
              {isLiveMode ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Issues */}
        <div className="env-debug-section">
          <div>Issues:</div>
          <ul className="env-debug-issues">
            {!hasApiKey && <li className="env-debug-issue">No API Key</li>}
            {!hasApiSecret && <li className="env-debug-issue">No API Secret</li>}
            {forceMock && <li className="env-debug-issue">Force Mock = true</li>}
            {isLiveMode && <li className="env-debug-success">All conditions met!</li>}
          </ul>
        </div>

        {/* Environment Variables */}
        <details className="env-debug-details">
          <summary>Show Environment Variables</summary>
          <pre className="env-debug-pre">
            {JSON.stringify(envVars, null, 2)}
          </pre>
        </details>
      </div>

      <div className="env-debug-footer">
        Mode: <span className={isLiveMode ? 'status-connected' : 'status-disconnected'}>
          {isLiveMode ? 'LIVE' : 'OFFLINE'}
        </span> | {envVars.NODE_ENV} | v{import.meta.env.VITE_APP_VERSION}
      </div>
    </div>
  );
};