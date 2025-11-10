/**
 * Futures WebSocket Authentication Test Suite
 * Validates HMAC-SHA256 signing for private channel subscriptions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import WebSocket from 'ws';
import { FuturesWebSocketClient, type ConnectionCredentials } from '../websocket/futuresWebSocket.js';

// Mock WebSocket
vi.mock('ws', () => {
  return {
    default: vi.fn()
  };
});

describe('FuturesWebSocket Authentication', () => {
  let client: FuturesWebSocketClient;
  let mockWS: any;
  const testCredentials: ConnectionCredentials = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    passphrase: 'test-passphrase'
  };

  beforeEach(() => {
    // Create mock WebSocket instance
    mockWS = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn()
    };

    // Mock WebSocket constructor
    (WebSocket as any).mockImplementation(() => mockWS);
    (WebSocket as any).OPEN = 1;

    client = new FuturesWebSocketClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Private Channel Subscription Signing', () => {
    it('should include HMAC-SHA256 signature when subscribing to private channels', async () => {
      // Connect to private WebSocket
      await client.connectPrivate(testCredentials);

      // Simulate connection opening and set readyState
      const openHandler = mockWS.on.mock.calls.find((call: any) => call[0] === 'open');
      if (openHandler) {
        // Set readyState to OPEN before calling handler
        mockWS.readyState = WebSocket.OPEN;
        openHandler[1]();
      }

      // Clear previous sends (from authentication)
      mockWS.send.mockClear();

      // Subscribe to private channels
      client.subscribeToPrivateChannels(['position', 'orders']);

      // Verify that send was called twice (once per channel)
      expect(mockWS.send).toHaveBeenCalledTimes(2);

      // Get the sent messages
      const sentMessages = mockWS.send.mock.calls.map((call: any) => JSON.parse(call[0]));

      // Verify both messages have required authentication fields
      sentMessages.forEach((msg: any) => {
        expect(msg).toHaveProperty('apiKey', testCredentials.apiKey);
        expect(msg).toHaveProperty('sign');
        expect(msg).toHaveProperty('timestamp');
        expect(msg).toHaveProperty('passphrase', testCredentials.passphrase);
        expect(msg).toHaveProperty('privateChannel', true);
        expect(msg).toHaveProperty('type', 'subscribe');

        // Verify signature is a base64 string (HMAC-SHA256 output)
        expect(msg.sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
      });
    });

    it('should generate correct HMAC-SHA256 signature', async () => {
      await client.connectPrivate(testCredentials);

      const openHandler = mockWS.on.mock.calls.find((call: any) => call[0] === 'open');
      if (openHandler) {
        mockWS.readyState = WebSocket.OPEN;
        openHandler[1]();
      }

      mockWS.send.mockClear();

      // Subscribe to a single channel
      client.subscribeToPrivateChannels(['wallet']);

      expect(mockWS.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(mockWS.send.mock.calls[0][0]);

      // Verify signature can be reproduced
      const timestamp = sentMessage.timestamp;
      const message = `${timestamp}GET/users/self/verify`;
      const expectedSignature = crypto
        .createHmac('sha256', testCredentials.apiSecret)
        .update(message)
        .digest('base64');

      expect(sentMessage.sign).toBe(expectedSignature);
    });

    it('should not subscribe to private channels without credentials', () => {
      // Create a new client without connecting
      const clientWithoutCreds = new FuturesWebSocketClient();
      
      // Manually set the private WS to simulate connection without auth
      (clientWithoutCreds as any).privateWS = mockWS;

      // Try to subscribe - should log error and not send
      clientWithoutCreds.subscribeToPrivateChannels(['wallet']);

      // Should not have sent any messages
      expect(mockWS.send).not.toHaveBeenCalled();
    });

    it('should handle subscription errors gracefully', async () => {
      await client.connectPrivate(testCredentials);

      const openHandler = mockWS.on.mock.calls.find((call: any) => call[0] === 'open');
      if (openHandler) {
        mockWS.readyState = WebSocket.OPEN;
        openHandler[1]();
      }

      // Add error event handler before causing error
      const errorSpy = vi.fn();
      client.on('error', errorSpy);

      // Make send throw an error
      mockWS.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      // Subscribe should not throw (errors are caught and emitted as events)
      expect(() => {
        client.subscribeToPrivateChannels(['wallet']);
      }).not.toThrow();

      // Verify error was emitted as event
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should not re-subscribe to already subscribed channels', async () => {
      await client.connectPrivate(testCredentials);

      const openHandler = mockWS.on.mock.calls.find((call: any) => call[0] === 'open');
      if (openHandler) {
        mockWS.readyState = WebSocket.OPEN;
        openHandler[1]();
      }

      mockWS.send.mockClear();

      // Subscribe twice to the same channel
      client.subscribeToPrivateChannels(['wallet']);
      client.subscribeToPrivateChannels(['wallet']);

      // Should only send once
      expect(mockWS.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Public Channel Subscriptions', () => {
    it('should NOT include signatures for public channel subscriptions', async () => {
      await client.connect();

      const openHandler = mockWS.on.mock.calls.find((call: any) => call[0] === 'open');
      if (openHandler) {
        mockWS.readyState = WebSocket.OPEN;
        openHandler[1]();
      }

      mockWS.send.mockClear();

      // Subscribe to public market data
      client.subscribeToMarketData('BTC-USDT', ['ticker']);

      expect(mockWS.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(mockWS.send.mock.calls[0][0]);

      // Public subscriptions should NOT have auth fields
      expect(sentMessage).not.toHaveProperty('apiKey');
      expect(sentMessage).not.toHaveProperty('sign');
      expect(sentMessage).not.toHaveProperty('passphrase');
      expect(sentMessage).toHaveProperty('type', 'subscribe');
      expect(sentMessage).toHaveProperty('topic', '/contractMarket/ticker:BTC-USDT');
    });
  });

  describe('Authentication Message', () => {
    it('should include signature in initial authentication', async () => {
      await client.connectPrivate(testCredentials);

      const openHandler = mockWS.on.mock.calls.find((call: any) => call[0] === 'open');
      if (openHandler) {
        mockWS.readyState = WebSocket.OPEN;
        openHandler[1]();
      }

      // The first send should be the authentication message
      expect(mockWS.send).toHaveBeenCalled();
      const authMessage = JSON.parse(mockWS.send.mock.calls[0][0]);

      // Verify authentication message structure
      expect(authMessage).toHaveProperty('apiKey', testCredentials.apiKey);
      expect(authMessage).toHaveProperty('sign');
      expect(authMessage).toHaveProperty('timestamp');
      expect(authMessage).toHaveProperty('passphrase', testCredentials.passphrase);
      expect(authMessage).toHaveProperty('topic', '/contractAccount/wallet');
      expect(authMessage).toHaveProperty('type', 'subscribe');
    });
  });
});
