/**
 * WebSocket Configuration Tests
 * 
 * Tests to validate the WebSocket configuration fixes and environment variable resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  getWebSocketUrl, 
  getWebSocketConfig, 
  validateWebSocketUrl,
  getWebSocketDebugInfo,
  getConnectionStrategy 
} from '@/config/websocket';

// Mock environment variables
const mockEnv = vi.hoisted(() => ({
  VITE_WS_URL: '',
  VITE_BACKEND_URL: '',
  VITE_RAILWAY_PUBLIC_DOMAIN: '',
  VITE_RAILWAY_PRIVATE_DOMAIN: '',
}));

vi.mock('@/utils/environment', () => ({
  getEnvVariable: (key: string, fallback = '') => mockEnv[key as keyof typeof mockEnv] || fallback,
}));

describe('WebSocket Configuration', () => {
  beforeEach(() => {
    // Reset mock environment
    Object.keys(mockEnv).forEach(key => {
      mockEnv[key as keyof typeof mockEnv] = '';
    });
    
    // Mock window.location for browser environment tests
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'localhost',
        protocol: 'http:',
      },
      writable: true,
    });
  });

  describe('getWebSocketUrl', () => {
    it('should use explicit WebSocket URL when provided', () => {
      mockEnv.VITE_WS_URL = 'wss://explicit.example.com';
      
      const url = getWebSocketUrl();
      expect(url).toBe('wss://explicit.example.com');
    });

    it('should convert backend URL to WebSocket URL', () => {
      mockEnv.VITE_BACKEND_URL = 'https://backend.example.com';
      
      const url = getWebSocketUrl();
      expect(url).toBe('wss://backend.example.com');
    });

    it('should use Railway public domain when available', () => {
      mockEnv.VITE_RAILWAY_PUBLIC_DOMAIN = 'polytrade-be.up.railway.app';
      
      const url = getWebSocketUrl();
      expect(url).toBe('wss://polytrade-be.up.railway.app');
    });

    it('should use Railway private domain as fallback', () => {
      mockEnv.VITE_RAILWAY_PRIVATE_DOMAIN = 'polytrade-be.railway.internal';
      
      const url = getWebSocketUrl();
      expect(url).toBe('wss://polytrade-be.railway.internal');
    });

    it('should handle localhost development environment', () => {
      // No environment variables set, should fall back to localhost detection
      const url = getWebSocketUrl();
      expect(url).toBe('ws://localhost:8765');
    });

    it('should handle HTTPS localhost properly', () => {
      window.location.protocol = 'https:';
      
      const url = getWebSocketUrl();
      expect(url).toBe('wss://localhost:8765');
    });

    it('should detect Railway deployment URL', () => {
      window.location.hostname = 'polytrade-fe.up.railway.app';
      window.location.protocol = 'https:';
      
      const url = getWebSocketUrl();
      expect(url).toBe('wss://polytrade-be.up.railway.app');
    });
  });

  describe('validateWebSocketUrl', () => {
    it('should validate WebSocket URLs correctly', () => {
      expect(validateWebSocketUrl('ws://localhost:8765')).toBe(true);
      expect(validateWebSocketUrl('wss://example.com')).toBe(true);
      expect(validateWebSocketUrl('https://example.com')).toBe(false);
      expect(validateWebSocketUrl('invalid-url')).toBe(false);
    });
  });

  describe('getWebSocketConfig', () => {
    it('should return complete configuration object', () => {
      mockEnv.VITE_WS_URL = 'wss://test.example.com';
      
      const config = getWebSocketConfig();
      
      expect(config).toEqual({
        url: 'wss://test.example.com',
        options: {
          transports: ['websocket', 'polling'],
          timeout: 10000,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          randomizationFactor: 0.5,
          forceNew: true,
          upgrade: true,
          rememberUpgrade: false,
        },
      });
    });
  });

  describe('getConnectionStrategy', () => {
    it('should return Railway production strategy', () => {
      // Mock production environment and Railway domain
      vi.stubGlobal('import', { meta: { env: { PROD: true } } });
      mockEnv.VITE_RAILWAY_PUBLIC_DOMAIN = 'polytrade-be.up.railway.app';
      
      const strategy = getConnectionStrategy();
      
      expect(strategy).toEqual({
        usePolling: true,
        preferWebSocket: true,
        maxRetries: 3,
      });
      
      // Restore the global
      vi.unstubAllGlobals();
    });

    it('should return development strategy', () => {
      // Mock development environment (default case)
      const strategy = getConnectionStrategy();
      
      expect(strategy).toEqual({
        usePolling: false,
        preferWebSocket: true,
        maxRetries: 5,
      });
    });
  });

  describe('getWebSocketDebugInfo', () => {
    it('should provide comprehensive debug information', () => {
      mockEnv.VITE_WS_URL = 'wss://debug.example.com';
      mockEnv.VITE_BACKEND_URL = 'https://backend.example.com';
      mockEnv.VITE_RAILWAY_PUBLIC_DOMAIN = 'railway.example.com';
      
      const debugInfo = getWebSocketDebugInfo();
      
      expect(debugInfo).toMatchObject({
        url: 'wss://debug.example.com',
        isValidUrl: true,
        environment: {
          backendUrl: 'https://backend.example.com',
          wsUrl: 'wss://debug.example.com',
          isRailway: true,
        },
        strategy: expect.any(Object),
        options: expect.any(Object),
      });
    });
  });
});