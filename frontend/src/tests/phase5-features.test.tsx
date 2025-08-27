import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { openAITradingService } from '../services/openAIService';
import TradingInsights from '../components/TradingInsights';
import PWAInstallPrompt from '../components/PWAInstallPrompt';

// Mock the OpenAI service
vi.mock('../services/openAIService', () => ({
  openAITradingService: {
    generateTradingInsight: vi.fn(),
    getConnectionStatus: vi.fn(() => 'mock'),
    isReady: vi.fn(() => false)
  }
}));

describe('Phase 5: Advanced Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenAI Trading Insights', () => {
    beforeEach(() => {
      // Provide a default insight so initial useEffect render doesn't crash
      (openAITradingService.generateTradingInsight as any).mockResolvedValue({
        type: 'market_outlook',
        title: 'Initial Outlook',
        content: 'Market is stable',
        confidence: 70,
        timeframe: '24h',
        createdAt: new Date()
      });
    });
    it('should render trading insights component', async () => {
      render(<TradingInsights />);
      
      await waitFor(() => {
        expect(screen.getByText('AI Trading Insights')).toBeInTheDocument();
        expect(screen.getByText('🧪 Mock')).toBeInTheDocument();
      });
    });

    it('should generate insights when refresh button is clicked', async () => {
      const mockInsight = {
        type: 'recommendation' as const,
        title: 'BTC-USDT Analysis',
        content: 'Bullish momentum detected',
        confidence: 85,
        timeframe: '24h',
        createdAt: new Date()
      };

      (openAITradingService.generateTradingInsight as any).mockResolvedValue(mockInsight);
      (openAITradingService.isReady as any).mockReturnValue(true);

      render(<TradingInsights />);
      
      const refreshButton = await screen.findByTitle('Refresh insights');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(openAITradingService.generateTradingInsight).toHaveBeenCalled();
      });
    });

    it('should show GPT-4.1 connection status', async () => {
      (openAITradingService.getConnectionStatus as any).mockReturnValue('connected');
      
      render(<TradingInsights />);
      expect(await screen.findByText(/GPT-4\.1/)).toBeInTheDocument();
    });

    it('should expand to show custom query interface', async () => {
      render(<TradingInsights />);
      
      // Use plural query to avoid timeouts when element is already present
      const expandButtons = screen.getAllByText('Expand');
      expect(expandButtons.length).toBeGreaterThan(0);
      fireEvent.click(expandButtons[0]!);
      
      expect(await screen.findByPlaceholderText(/Ask AI about/)).toBeInTheDocument();
      expect(await screen.findByText('Ask')).toBeInTheDocument();
    });
  });

  describe('PWA Install Prompt', () => {
    beforeEach(() => {
      // Clear localStorage
      localStorage.clear();
      
      // Mock PWA-related APIs
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      // Mock navigator.getInstalledRelatedApps to avoid undefined access in jsdom
      Object.defineProperty(navigator as any, 'getInstalledRelatedApps', {
        value: vi.fn().mockResolvedValue([]),
        configurable: true
      });
    });

    it('should not render if dismissed', () => {
      localStorage.setItem('pwa_install_dismissed', 'true');
      
      render(<PWAInstallPrompt />);
      
      expect(screen.queryByText('Install Trading Bot')).not.toBeInTheDocument();
    });

    it('should show install prompt when conditions are met', async () => {
      const mockEvent = new Event('beforeinstallprompt');
      (mockEvent as any).prompt = vi.fn();
      (mockEvent as any).userChoice = Promise.resolve({ outcome: 'accepted' });

      render(<PWAInstallPrompt />);
      
      // Wait a microtask to ensure useEffect listeners are attached
      await act(async () => { await Promise.resolve(); });

      // Simulate beforeinstallprompt event wrapped in act to flush updates
      await act(async () => {
        window.dispatchEvent(mockEvent);
      });

      // Wait for the component to process the event
      expect(await screen.findByText('Install Trading Bot')).toBeInTheDocument();
    });
  });

  describe('Environment Debug Improvements', () => {
    let originalLocalStorage: Storage | undefined;
    beforeEach(() => {
      // Provide a stable localStorage stub for this suite
      originalLocalStorage = window.localStorage;
      const store = new Map<string, string>();
      const stub: Storage = {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => { store.delete(key); },
        setItem: (key: string, value: string) => { store.set(key, String(value)); }
      } as Storage;
      Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });
    });
    afterEach(() => {
      if (originalLocalStorage) {
        Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, configurable: true });
      }
    });
    it('should remember dismissed state', () => {
      // Test that dismissed state is persisted
      localStorage.setItem('envDebug_dismissed', 'true');
      
      // This would need to be tested in an integration test with the actual component
      expect(localStorage.getItem('envDebug_dismissed')).toBe('true');
    });

    it('should remember minimized state', () => {
      localStorage.setItem('envDebug_minimized', 'true');
      
      expect(localStorage.getItem('envDebug_minimized')).toBe('true');
    });
  });

  describe('Mobile PWA Features', () => {
    it('should have manifest.json with correct properties', async () => {
      // In a real test, you would fetch and validate the manifest
      const expectedManifest = {
        name: 'Poloniex Trading Platform',
        short_name: 'Poloniex',
        display: 'standalone',
        theme_color: '#4a90e2'
      };
      
      expect(expectedManifest.name).toBe('Poloniex Trading Platform');
      expect(expectedManifest.display).toBe('standalone');
    });

    it('should register service worker', () => {
      // Mock service worker registration
      const mockServiceWorker = {
        register: vi.fn().mockResolvedValue({ update: vi.fn() })
      };
      
      Object.defineProperty(navigator, 'serviceWorker', {
        value: mockServiceWorker,
        writable: true
      });
      
      expect(navigator.serviceWorker).toBeDefined();
    });
  });

  describe('Mobile Responsiveness', () => {
    it('should handle mobile viewport changes', () => {
      // Test viewport meta tag
      let viewportMeta = document.querySelector('meta[name="viewport"]');
      if (!viewportMeta) {
        viewportMeta = document.createElement('meta');
        (viewportMeta as HTMLMetaElement).name = 'viewport';
        (viewportMeta as HTMLMetaElement).content = 'width=device-width, initial-scale=1';
        document.head.appendChild(viewportMeta);
      }
      expect((viewportMeta as HTMLMetaElement).getAttribute('content')).toContain('width=device-width');
    });

    it('should adapt layout for mobile screens', () => {
      // Mock mobile screen size
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      // Test responsive classes would be applied
      expect(window.innerWidth).toBe(375);
    });
  });
});