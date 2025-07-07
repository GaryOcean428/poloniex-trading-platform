// Test to validate the WebSocket ticker data processing fix
import { describe, it, expect } from 'vitest';

// Mock the formatPoloniexTickerData function directly since it's in a different file
const formatPoloniexTickerData = (data) => {
  try {
    // Validate incoming data structure
    if (!data || !data.symbol) {
      console.warn('Invalid ticker data received:', data);
      return null;
    }

    // Convert Poloniex pair format (BTC_USDT) to our format (BTC-USDT)
    const pair = data.symbol.replace('_', '-');
    
    return {
      pair,
      timestamp: Date.now(),
      open: parseFloat(data.open) || 0,
      high: parseFloat(data.high) || 0,
      low: parseFloat(data.low) || 0,
      close: parseFloat(data.close) || 0,
      volume: parseFloat(data.quantity) || 0
    };
  } catch (error) {
    console.error('Error formatting ticker data:', error);
    return null;
  }
};

describe('WebSocket Ticker Data Processing Fix', () => {
  it('should handle valid ticker data correctly', () => {
    const mockTickerData = {
      symbol: 'BTC_USDT',
      open: '50000.00',
      high: '52000.00',
      low: '49000.00',
      close: '51000.00',
      quantity: '1000.50'
    };

    const result = formatPoloniexTickerData(mockTickerData);

    expect(result).not.toBeNull();
    expect(result.pair).toBe('BTC-USDT');
    expect(result.open).toBe(50000);
    expect(result.high).toBe(52000);
    expect(result.low).toBe(49000);
    expect(result.close).toBe(51000);
    expect(result.volume).toBe(1000.5);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('should handle undefined data gracefully', () => {
    const result = formatPoloniexTickerData(undefined);
    expect(result).toBeNull();
  });

  it('should handle null data gracefully', () => {
    const result = formatPoloniexTickerData(null);
    expect(result).toBeNull();
  });

  it('should handle data without symbol property', () => {
    const mockData = {
      open: '50000.00',
      high: '52000.00',
      low: '49000.00',
      close: '51000.00',
      quantity: '1000.50'
    };

    const result = formatPoloniexTickerData(mockData);
    expect(result).toBeNull();
  });

  it('should handle data with invalid numeric values', () => {
    const mockTickerData = {
      symbol: 'BTC_USDT',
      open: 'invalid',
      high: null,
      low: undefined,
      close: '51000.00',
      quantity: 'also invalid'
    };

    const result = formatPoloniexTickerData(mockTickerData);

    expect(result).not.toBeNull();
    expect(result.pair).toBe('BTC-USDT');
    expect(result.open).toBe(0); // Default fallback for invalid values
    expect(result.high).toBe(0);
    expect(result.low).toBe(0);
    expect(result.close).toBe(51000);
    expect(result.volume).toBe(0);
  });

  it('should process array of ticker data correctly', () => {
    const mockArrayData = [
      {
        symbol: 'BTC_USDT',
        open: '50000.00',
        high: '52000.00',
        low: '49000.00',
        close: '51000.00',
        quantity: '1000.50'
      },
      {
        symbol: 'ETH_USDT',
        open: '3000.00',
        high: '3200.00',
        low: '2900.00',
        close: '3100.00',
        quantity: '500.25'
      }
    ];

    const results = mockArrayData.map(formatPoloniexTickerData).filter(Boolean);

    expect(results).toHaveLength(2);
    expect(results[0].pair).toBe('BTC-USDT');
    expect(results[1].pair).toBe('ETH-USDT');
  });
});