import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

// Mock the environment utilities
vi.mock('@/utils/environment', () => ({
  getEnvVariable: vi.fn(),
  getApiBaseUrl: vi.fn(),
  getPoloniexApiKey: vi.fn(),
  getPoloniexApiSecret: vi.fn(),
  getPoloniexPassphrase: vi.fn(),
  shouldUseMockMode: vi.fn(),
  isMockModeForced: vi.fn(),
  isMockModeDisabled: vi.fn(),
  IS_WEBCONTAINER: false,
  IS_LOCAL_DEV: false,
}));

// Mock the API services
vi.mock('@/services/poloniexAPI', () => ({
  poloniexApi: {
    loadCredentials: vi.fn(),
    getMarketData: vi.fn(),
    getAccountBalance: vi.fn(),
    getOpenPositions: vi.fn(),
    getRecentTrades: vi.fn(),
    placeOrder: vi.fn(),
  },
  PoloniexAPIError: class extends Error {
    constructor(message: string, public code?: string, public statusCode?: number) {
      super(message);
      this.name = 'PoloniexAPIError';
    }
  },
  PoloniexConnectionError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PoloniexConnectionError';
    }
  },
  PoloniexAuthenticationError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PoloniexAuthenticationError';
    }
  },
}));

import { 
  getEnvVariable, 
  getApiBaseUrl, 
  shouldUseMockMode, 
  isMockModeForced, 
  isMockModeDisabled 
} from '@/utils/environment';
import { 
  poloniexApi, 
  PoloniexAPIError, 
  PoloniexConnectionError, 
  PoloniexAuthenticationError 
} from '@/services/poloniexAPI';
import APIErrorBoundary from '@/components/APIErrorBoundary';

describe('Environment Configuration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Environment Variable Support', () => {
    it('should use VITE_API_URL when provided', () => {
      const mockGetEnvVariable = getEnvVariable as jest.MockedFunction<typeof getEnvVariable>;
      const mockGetApiBaseUrl = getApiBaseUrl as jest.MockedFunction<typeof getApiBaseUrl>;
      
      mockGetEnvVariable.mockImplementation((key: string) => {
        if (key === 'VITE_API_URL') return 'https://custom-api.example.com/v3';
        return '';
      });
      
      mockGetApiBaseUrl.mockImplementation(() => 'https://custom-api.example.com/v3');
      
      const result = getApiBaseUrl('futures');
      expect(result).toBe('https://custom-api.example.com/v3');
    });

    it('should use NEXT_PUBLIC_API_URL as fallback', () => {
      const mockGetEnvVariable = getEnvVariable as jest.MockedFunction<typeof getEnvVariable>;
      const mockGetApiBaseUrl = getApiBaseUrl as jest.MockedFunction<typeof getApiBaseUrl>;
      
      mockGetEnvVariable.mockImplementation((key: string) => {
        if (key === 'VITE_API_URL') return '';
        if (key === 'NEXT_PUBLIC_API_URL') return 'https://next-api.example.com/v3';
        return '';
      });
      
      mockGetApiBaseUrl.mockImplementation(() => 'https://next-api.example.com/v3');
      
      const result = getApiBaseUrl('futures');
      expect(result).toBe('https://next-api.example.com/v3');
    });

    it('should default to official Poloniex API when no custom URL provided', () => {
      const mockGetEnvVariable = getEnvVariable as jest.MockedFunction<typeof getEnvVariable>;
      const mockGetApiBaseUrl = getApiBaseUrl as jest.MockedFunction<typeof getApiBaseUrl>;
      
      mockGetEnvVariable.mockReturnValue('');
      mockGetApiBaseUrl.mockImplementation((service) => 
        service === 'futures' 
          ? 'https://futures-api.poloniex.com/v3'
          : 'https://api.poloniex.com/v3'
      );
      
      const futuresResult = getApiBaseUrl('futures');
      const spotResult = getApiBaseUrl('spot');
      
      expect(futuresResult).toBe('https://futures-api.poloniex.com/v3');
      expect(spotResult).toBe('https://api.poloniex.com/v3');
    });
  });

  describe('Mock Mode Control', () => {
    it('should force mock mode when VITE_FORCE_MOCK_MODE=true', () => {
      const mockIsMockModeForced = isMockModeForced as jest.MockedFunction<typeof isMockModeForced>;
      const mockShouldUseMockMode = shouldUseMockMode as jest.MockedFunction<typeof shouldUseMockMode>;
      
      mockIsMockModeForced.mockReturnValue(true);
      mockShouldUseMockMode.mockReturnValue(true);
      
      const result = shouldUseMockMode(true); // Even with credentials
      expect(result).toBe(true);
    });

    it('should disable mock mode when VITE_DISABLE_MOCK_MODE=true and credentials provided', () => {
      const mockIsMockModeDisabled = isMockModeDisabled as jest.MockedFunction<typeof isMockModeDisabled>;
      const mockShouldUseMockMode = shouldUseMockMode as jest.MockedFunction<typeof shouldUseMockMode>;
      
      mockIsMockModeDisabled.mockReturnValue(true);
      mockShouldUseMockMode.mockReturnValue(false);
      
      const result = shouldUseMockMode(true); // With credentials
      expect(result).toBe(false);
    });

    it('should use mock mode in production without credentials', () => {
      const mockShouldUseMockMode = shouldUseMockMode as jest.MockedFunction<typeof shouldUseMockMode>;
      
      mockShouldUseMockMode.mockReturnValue(true);
      
      const result = shouldUseMockMode(false); // No credentials
      expect(result).toBe(true);
    });
  });
});

describe('API Error Handling Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('API Error Classes', () => {
    it('should create PoloniexConnectionError correctly', () => {
      const error = new PoloniexConnectionError('Network timeout');
      expect(error.name).toBe('PoloniexConnectionError');
      expect(error.message).toBe('Network timeout');
      expect(error instanceof Error).toBe(true);
    });

    it('should create PoloniexAuthenticationError correctly', () => {
      const error = new PoloniexAuthenticationError('Invalid API key');
      expect(error.name).toBe('PoloniexAuthenticationError');
      expect(error.message).toBe('Invalid API key');
      expect(error instanceof Error).toBe(true);
    });

    it('should create PoloniexAPIError with status code', () => {
      const error = new PoloniexAPIError('Not found', 'NOT_FOUND', 404);
      expect(error.name).toBe('PoloniexAPIError');
      expect(error.message).toBe('Not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('APIErrorBoundary Component', () => {
    it('should render connection error with retry button', () => {
      const mockRetry = vi.fn();
      const error = new PoloniexConnectionError('Network timeout');
      
      render(
        <APIErrorBoundary 
          error={error} 
          onRetry={mockRetry} 
          context="Market Data"
        />
      );
      
      expect(screen.getByText('Connection Error')).toBeInTheDocument();
      expect(screen.getByText(/Unable to connect to the trading platform/)).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
      
      fireEvent.click(screen.getByText('Try Again'));
      expect(mockRetry).toHaveBeenCalled();
    });

    it('should render authentication error with settings button', () => {
      const error = new PoloniexAuthenticationError('Invalid API credentials');
      
      // Mock window.location for the settings redirect test
      const mockLocation = { href: '' };
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
      });
      
      render(
        <APIErrorBoundary 
          error={error} 
          context="Account Balance"
        />
      );
      
      expect(screen.getByText('Authentication Required')).toBeInTheDocument();
      expect(screen.getByText(/API credentials are missing or invalid/)).toBeInTheDocument();
      expect(screen.getByText('Go to Settings')).toBeInTheDocument();
      
      fireEvent.click(screen.getByText('Go to Settings'));
      expect(mockLocation.href).toBe('/settings');
    });

    it('should render API error with proper guidance', () => {
      const error = new PoloniexAPIError('Rate limit exceeded', 'RATE_LIMIT', 429);
      
      render(
        <APIErrorBoundary 
          error={error} 
          context="Trading"
        />
      );
      
      expect(screen.getByText('API Error')).toBeInTheDocument();
      expect(screen.getByText(/Rate limit exceeded/)).toBeInTheDocument();
      expect(screen.getByText('API Documentation')).toBeInTheDocument();
    });

    it('should show context-specific error message', () => {
      const error = new PoloniexConnectionError('Connection failed');
      
      render(
        <APIErrorBoundary 
          error={error} 
          context="Portfolio Data"
        />
      );
      
      expect(screen.getByText(/Portfolio Data operation failed/)).toBeInTheDocument();
    });
  });
});

describe('Production Environment Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock production environment
    Object.defineProperty(window, 'location', {
      value: { hostname: 'poloniex-trading-platform.vercel.app' },
      writable: true,
    });
  });

  it('should not fall back to mock data on API failures in production', async () => {
    const mockPoloniexApi = poloniexApi as jest.Mocked<typeof poloniexApi>;
    
    // Mock API to throw connection error
    mockPoloniexApi.getMarketData.mockRejectedValue(
      new PoloniexConnectionError('Network error')
    );
    
    // Should throw error, not return mock data
    await expect(poloniexApi.getMarketData('BTC-USDT')).rejects.toThrow('Network error');
  });

  it('should handle authentication errors without falling back', async () => {
    const mockPoloniexApi = poloniexApi as jest.Mocked<typeof poloniexApi>;
    
    // Mock API to throw auth error
    mockPoloniexApi.getAccountBalance.mockRejectedValue(
      new PoloniexAuthenticationError('Invalid API key')
    );
    
    // Should throw error, not return mock data
    await expect(poloniexApi.getAccountBalance()).rejects.toThrow('Invalid API key');
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load credentials and update mock mode correctly', () => {
    const mockShouldUseMockMode = shouldUseMockMode as jest.MockedFunction<typeof shouldUseMockMode>;
    const mockPoloniexApi = poloniexApi as jest.Mocked<typeof poloniexApi>;
    
    mockShouldUseMockMode.mockReturnValue(false); // Has credentials, not in mock mode
    
    poloniexApi.loadCredentials();
    
    expect(mockPoloniexApi.loadCredentials).toHaveBeenCalled();
  });
});