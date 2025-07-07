import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { webSocketService } from '../services/websocketService';
import { usePageVisibility } from '../hooks/usePageVisibility';

interface WebSocketContextType {
  isConnected: boolean;
  connectionState: string;
  lastError: string | null;
  connectionHealth: {
    isHealthy: boolean;
    uptime: number;
    latency: number | null;
    reconnectAttempts: number;
  };
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const [contextState, setContextState] = React.useState<WebSocketContextType>({
    isConnected: false,
    connectionState: 'disconnected',
    lastError: null,
    connectionHealth: {
      isHealthy: false,
      uptime: 0,
      latency: null,
      reconnectAttempts: 0
    }
  });

  // Handle page visibility changes
  usePageVisibility(
    () => {
      // Page visible - ensure connection
      webSocketService.handlePageVisibilityChange(true);
    },
    () => {
      // Page hidden - maintain connection in background
      webSocketService.handlePageVisibilityChange(false);
    },
    30000 // 30 second grace period
  );

  useEffect(() => {
    // Connection state change handler
    const handleConnectionStateChange = (state: string) => {
      setContextState(prev => ({
        ...prev,
        connectionState: state,
        isConnected: state === 'connected'
      }));
    };

    // Error handler
    const handleError = (error: any) => {
      setContextState(prev => ({
        ...prev,
        lastError: error?.message || 'Unknown error'
      }));
    };

    // Set up event listeners
    webSocketService.on('connectionStateChanged', handleConnectionStateChange);
    webSocketService.on('error', handleError);

    // Initialize connection
    webSocketService.connect().catch(console.error);

    // Update connection health periodically
    const healthInterval = setInterval(() => {
      const health = webSocketService.getConnectionHealth();
      setContextState(prev => ({
        ...prev,
        connectionHealth: {
          isHealthy: health.isHealthy,
          uptime: health.uptime,
          latency: health.latency,
          reconnectAttempts: health.reconnectAttempts
        }
      }));
    }, 5000);

    // Cleanup
    return () => {
      clearInterval(healthInterval);
      webSocketService.off('connectionStateChanged', handleConnectionStateChange);
      webSocketService.off('error', handleError);
      webSocketService.disconnect();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={contextState}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};