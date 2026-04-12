/**
 * Autonomous Agent Test Suite
 * Tests the complete agent lifecycle and functionality
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../db/connection.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';
let authToken: string;
let userId: number;
let request: ((url: string) => any) | null = null;

try {
  request = (await import('supertest')).default as (url: string) => any;
} catch {
  request = null;
}

const describeIfSupertest = request ? describe : describe.skip;
const requestClient = request as NonNullable<typeof request>;

describeIfSupertest('Autonomous Agent API', () => {
  beforeAll(async () => {
    // Create test user and get auth token
    const registerRes = await requestClient(API_URL)
      .post('/api/auth/register')
      .send({
        email: `test_${Date.now()}@example.com`,
        password: 'TestPassword123!',
        username: 'TestUser'
      });

    expect(registerRes.status).toBe(200);
    expect(registerRes.body.token).toBeDefined();
    
    authToken = registerRes.body.token;
    userId = registerRes.body.user.id;
  });

  afterAll(async () => {
    // Cleanup: delete test user and related data
    if (userId) {
      await pool.query('DELETE FROM agent_sessions WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await pool.end();
  });

  describe('Authentication', () => {
    test('should reject requests without auth token', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/status');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('should accept requests with valid auth token', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Agent Lifecycle', () => {
    test('should start agent with valid configuration', async () => {
      const config = {
        maxDrawdown: 15,
        positionSize: 2,
        maxConcurrentPositions: 3,
        stopLossPercentage: 5,
        tradingStyle: 'day_trading',
        preferredPairs: ['BTC-USDT', 'ETH-USDT'],
        preferredTimeframes: ['15m', '1h', '4h'],
        automationLevel: 'fully_autonomous'
      };

      const res = await requestClient(API_URL)
        .post('/api/agent/start')
        .set('Authorization', `Bearer ${authToken}`)
        .send(config);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.status).toBe('running');
    });

    test('should get agent status', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBeDefined();
    });

    test('should pause agent', async () => {
      const res = await requestClient(API_URL)
        .post('/api/agent/pause')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('should stop agent', async () => {
      const res = await requestClient(API_URL)
        .post('/api/agent/stop')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Strategy Generation', () => {
    test('should generate strategies', async () => {
      // Start agent first
      await requestClient(API_URL)
        .post('/api/agent/start')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          maxDrawdown: 15,
          positionSize: 2,
          preferredPairs: ['BTC-USDT']
        });

      // Wait for strategies to be generated (mock mode should be fast)
      await new Promise(resolve => setTimeout(resolve, 3000));

      const res = await requestClient(API_URL)
        .get('/api/agent/strategies')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.strategies)).toBe(true);
    });
  });

  describe('Activity Logging', () => {
    test('should log agent activities', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/activity?limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.activity)).toBe(true);
    });
  });

  describe('Performance Metrics', () => {
    test('should return performance metrics', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/performance')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.performance).toBeDefined();
      expect(typeof res.body.performance.totalPnl).toBe('number');
      expect(typeof res.body.performance.winRate).toBe('number');
    });
  });

  describe('Configuration', () => {
    test('should update agent configuration', async () => {
      const newConfig = {
        maxDrawdown: 20,
        positionSize: 3
      };

      const res = await requestClient(API_URL)
        .put('/api/agent/config')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newConfig);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid configuration', async () => {
      const invalidConfig = {
        maxDrawdown: -10, // Invalid: negative
        positionSize: 0 // Invalid: zero
      };

      const res = await requestClient(API_URL)
        .post('/api/agent/start')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidConfig);

      // Should either reject or sanitize the config
      expect([400, 500]).toContain(res.status);
    });

    test('should handle missing required fields', async () => {
      const res = await requestClient(API_URL)
        .post('/api/agent/start')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect([400, 500]).toContain(res.status);
    });
  });
});
