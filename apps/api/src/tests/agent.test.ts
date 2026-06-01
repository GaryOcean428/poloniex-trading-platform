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

  // Agent Lifecycle — the Monkey kernel is the sole autonomous trader and
  // runs continuously. /start and /resume are legacy compatibility wrappers
  // that flip execution mode back to 'auto'.
  describe('Agent Lifecycle', () => {
    test('should get agent status', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBeDefined();
      // PR6 — the on/off badge reflects real kernel trading activity.
      expect(['running', 'paused', 'stopped']).toContain(res.body.status.status);
      expect(['active', 'idle', 'paused']).toContain(res.body.status.kernelStatus);
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
    test('should resume agent via legacy /start wrapper', async () => {
      const res = await requestClient(API_URL)
        .post('/api/agent/start')
        .set('Authorization', 'Bearer ' + authToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mode).toBe('auto');
    });

    test('should resume agent via legacy /resume wrapper', async () => {
      const res = await requestClient(API_URL)
        .post('/api/agent/resume')
        .set('Authorization', 'Bearer ' + authToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mode).toBe('auto');
    });
  });

  describe('Strategy Generation', () => {
    test('should list strategies', async () => {
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

  // The 'Configuration' and 'Error Handling' describes were removed in
  // PR7. They exercised `PUT /api/agent/config` (deleted 2026-05-21 — it
  // only configured the deleted fullyAutonomousTrader engine) and
  // `POST /api/agent/start` with knob payloads (route deleted in PR7).
  // The kernel observes and sets all of its own parameters (P1); there
  // is no operator config route to validate.

  describe('Execution Mode', () => {
    test('should read the global execution mode', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/execution-mode')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(['auto', 'paper_only', 'pause']).toContain(res.body.mode);
    });

    test('should reject an invalid execution mode', async () => {
      const res = await requestClient(API_URL)
        .put('/api/agent/execution-mode')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ mode: 'turbo' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Feature Flags', () => {
    test('should list feature flags', async () => {
      const res = await requestClient(API_URL)
        .get('/api/agent/feature-flags')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.flags)).toBe(true);
    });

    test('should update a known boolean flag', async () => {
      const res = await requestClient(API_URL)
        .put('/api/agent/feature-flags/MONKEY_SHORTS_LIVE')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 'false' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.value).toBe('false');
    });

    test('should reject a non-boolean value', async () => {
      const res = await requestClient(API_URL)
        .put('/api/agent/feature-flags/MONKEY_SHORTS_LIVE')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('should reject an unknown flag key', async () => {
      const res = await requestClient(API_URL)
        .put('/api/agent/feature-flags/NOT_A_REAL_FLAG')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 'true' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
