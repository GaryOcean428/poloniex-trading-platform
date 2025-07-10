import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/store';

describe('Zustand State Management', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.getState().clearApiCredentials();
    useAppStore.getState().clearToasts();
  });

  describe('API Credentials Management', () => {
    it('should store and retrieve API credentials', () => {
      const { setApiCredentials, clearApiCredentials } = useAppStore.getState();
      
      // Test setting credentials
      setApiCredentials({
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
        isLiveTrading: true
      });
      
      const credentials = useAppStore.getState().apiCredentials;
      expect(credentials.apiKey).toBe('test-api-key');
      expect(credentials.apiSecret).toBe('test-api-secret');
      expect(credentials.isLiveTrading).toBe(true);
      
      // Test clearing credentials
      clearApiCredentials();
      const clearedCredentials = useAppStore.getState().apiCredentials;
      expect(clearedCredentials.apiKey).toBe('');
      expect(clearedCredentials.apiSecret).toBe('');
      expect(clearedCredentials.isLiveTrading).toBe(false);
    });

    it('should update partial credentials', () => {
      const { setApiCredentials } = useAppStore.getState();
      
      // Set initial credentials
      setApiCredentials({
        apiKey: 'initial-key',
        apiSecret: 'initial-secret',
        isLiveTrading: false
      });
      
      // Update only isLiveTrading
      setApiCredentials({ isLiveTrading: true });
      
      const credentials = useAppStore.getState().apiCredentials;
      expect(credentials.apiKey).toBe('initial-key');
      expect(credentials.apiSecret).toBe('initial-secret');
      expect(credentials.isLiveTrading).toBe(true);
    });
  });

  describe('UI Settings Management', () => {
    it('should manage dark mode setting', () => {
      const { setDarkMode } = useAppStore.getState();
      
      // Test enabling dark mode
      setDarkMode(true);
      expect(useAppStore.getState().ui.darkMode).toBe(true);
      
      // Test disabling dark mode
      setDarkMode(false);
      expect(useAppStore.getState().ui.darkMode).toBe(false);
    });

    it('should manage notification settings', () => {
      const { setNotifications } = useAppStore.getState();
      
      // Test updating notification settings
      setNotifications({
        email: false,
        trade: true,
        price: false,
        chat: true
      });
      
      const notifications = useAppStore.getState().ui.notifications;
      expect(notifications.email).toBe(false);
      expect(notifications.trade).toBe(true);
      expect(notifications.price).toBe(false);
      expect(notifications.chat).toBe(true);
    });
  });

  describe('Toast Notifications', () => {
    it('should add and remove toast notifications', () => {
      const { addToast, removeToast } = useAppStore.getState();
      
      // Add a toast
      addToast({
        message: 'Test notification',
        type: 'success',
        dismissible: true
      });
      
      const toasts = useAppStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe('Test notification');
      expect(toasts[0].type).toBe('success');
      expect(toasts[0]).toHaveProperty('id');
      expect(toasts[0]).toHaveProperty('timestamp');
      
      // Remove the toast
      removeToast(toasts[0].id);
      expect(useAppStore.getState().toasts).toHaveLength(0);
    });

    it('should add multiple toasts', () => {
      const { addToast } = useAppStore.getState();
      
      addToast({ message: 'First toast', type: 'info', dismissible: true });
      addToast({ message: 'Second toast', type: 'warning', dismissible: true });
      addToast({ message: 'Third toast', type: 'error', dismissible: true });
      
      const toasts = useAppStore.getState().toasts;
      expect(toasts).toHaveLength(3);
      expect(toasts[0].message).toBe('First toast');
      expect(toasts[1].message).toBe('Second toast');
      expect(toasts[2].message).toBe('Third toast');
    });

    it('should clear all toasts', () => {
      const { addToast, clearToasts } = useAppStore.getState();
      
      // Add multiple toasts
      addToast({ message: 'Toast 1', type: 'info', dismissible: true });
      addToast({ message: 'Toast 2', type: 'warning', dismissible: true });
      
      expect(useAppStore.getState().toasts).toHaveLength(2);
      
      // Clear all toasts
      clearToasts();
      expect(useAppStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('Trading Settings', () => {
    it('should manage default pair setting', () => {
      const { setDefaultPair } = useAppStore.getState();
      
      setDefaultPair('ETH_USDT');
      expect(useAppStore.getState().trading.defaultPair).toBe('ETH_USDT');
      
      setDefaultPair('BTC_USDT');
      expect(useAppStore.getState().trading.defaultPair).toBe('BTC_USDT');
    });

    it('should manage mock mode setting', () => {
      const { setMockMode } = useAppStore.getState();
      
      setMockMode(false);
      expect(useAppStore.getState().trading.mockMode).toBe(false);
      
      setMockMode(true);
      expect(useAppStore.getState().trading.mockMode).toBe(true);
    });
  });
});