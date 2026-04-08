import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock global fetch used by HTTP transport
const fetchMock = vi.fn();
global.fetch = fetchMock;

// Mock redis client
const redisMockGet = vi.fn();
const redisMockPublish = vi.fn();
const redisMockSubscribe = vi.fn();
const redisMockUnsubscribe = vi.fn();
const redisMockConnect = vi.fn().mockResolvedValue(undefined);
const redisMockOn = vi.fn();

const createRedisMock = () => ({
  connect: redisMockConnect,
  on: redisMockOn,
  get: redisMockGet,
  publish: redisMockPublish,
  subscribe: redisMockSubscribe,
  unsubscribe: redisMockUnsubscribe,
});

vi.mock('redis', () => ({
  createClient: vi.fn(() => createRedisMock()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_OHLCV = Array.from({ length: 30 }, (_, i) => ({
  timestamp: Date.now() - (30 - i) * 3600_000,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 100 + i,
  volume: 1000,
}));

describe('MLPredictionService', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    redisMockGet.mockReset();
    redisMockPublish.mockReset();
    redisMockSubscribe.mockReset();
    redisMockUnsubscribe.mockReset();
    redisMockConnect.mockResolvedValue(undefined);
    delete process.env.ML_WORKER_URL;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_PUBLIC_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP transport', () => {
    it('calls the ml-worker /ml/predict endpoint and returns prediction result', async () => {
      process.env.ML_WORKER_URL = 'http://ml-worker:8000';

      const mockResult = { status: 'success', signal: 'BUY', strength: 0.75, reason: 'regime=creator strategy=momentum' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const { default: service } = await import('../services/mlPredictionService.js');
      const result = await service.getTradingSignal('BTC_USDT', SAMPLE_OHLCV, 100);

      expect(result.signal).toBe('BUY');
      expect(result.strength).toBe(0.75);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('http://ml-worker:8000/ml/predict');
      expect(JSON.parse(opts.body)).toMatchObject({ action: 'signal', symbol: 'BTC_USDT' });
    });

    it('returns multi-horizon predictions via HTTP', async () => {
      process.env.ML_WORKER_URL = 'http://ml-worker:8000';

      const mockResult = {
        status: 'success',
        '1h': { price: 101, confidence: 72, direction: 'BULLISH' },
        '4h': { price: 103, confidence: 65, direction: 'BULLISH' },
        '24h': { price: 108, confidence: 58, direction: 'BULLISH' },
      };
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const { default: service } = await import('../services/mlPredictionService.js');
      const result = await service.getMultiHorizonPredictions('BTC_USDT', SAMPLE_OHLCV);

      expect(result['1h'].confidence).toBeGreaterThan(50);
      expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(result['1h'].direction);
    });

    it('throws when ml-worker is unreachable via both HTTP and Redis', async () => {
      process.env.ML_WORKER_URL = 'http://ml-worker:8000';
      process.env.REDIS_URL = 'redis://localhost:6379';
      // HTTP fails with 503
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' });
      // Redis subscribe fails too
      redisMockSubscribe.mockRejectedValueOnce(new Error('Redis connection refused'));

      const { default: service } = await import('../services/mlPredictionService.js');
      await expect(service.getMultiHorizonPredictions('BTC_USDT', SAMPLE_OHLCV)).rejects.toThrow(
        /ML worker unavailable/,
      );
    });
  });

  describe('Redis pub/sub transport', () => {
    it('falls back to Redis pub/sub when HTTP fails', async () => {
      process.env.ML_WORKER_URL = 'http://ml-worker:8000';
      process.env.REDIS_URL = 'redis://localhost:6379';

      // HTTP fails
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const mockResponse = {
        status: 'success',
        requestId: 'test-id',
        signal: 'HOLD',
        strength: 0.4,
        reason: 'regime=dissolver strategy=cash',
      };

      // Redis subscribe succeeds, onMessage fires with the mock response
      redisMockSubscribe.mockImplementation(async (_channel, onMessage) => {
        // Simulate the worker responding after a short delay
        setTimeout(() => onMessage(JSON.stringify(mockResponse)), 10);
      });
      redisMockPublish.mockResolvedValue(1);
      redisMockUnsubscribe.mockResolvedValue(undefined);

      const { default: service } = await import('../services/mlPredictionService.js');
      const result = await service.getTradingSignal('BTC_USDT', SAMPLE_OHLCV, 100);

      expect(result.signal).toBe('HOLD');
      expect(redisMockPublish).toHaveBeenCalledWith(
        'ml:predict:request',
        expect.stringContaining('"action":"signal"'),
      );
    });
  });

  describe('fallback behaviour', () => {
    it('throws when neither ML_WORKER_URL nor REDIS_URL is configured', async () => {
      const { default: service } = await import('../services/mlPredictionService.js');
      await expect(service.getMultiHorizonPredictions('BTC_USDT', SAMPLE_OHLCV)).rejects.toThrow(
        /ML worker unreachable/,
      );
    });

    it('getTradingSignal returns HOLD with error flag on complete failure', async () => {
      // No transports configured — getTradingSignal catches internally and returns neutral
      const { default: service } = await import('../services/mlPredictionService.js');
      const result = await service.getTradingSignal('BTC_USDT', SAMPLE_OHLCV, 100);
      expect(result.signal).toBe('HOLD');
      expect(result.error).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('returns true when ml-worker HTTP /health responds OK', async () => {
      process.env.ML_WORKER_URL = 'http://ml-worker:8000';
      // Heartbeat Redis check will fail (no Redis), so it falls through to HTTP
      redisMockGet.mockResolvedValue(null);
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });

      const { default: service } = await import('../services/mlPredictionService.js');
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });

    it('returns false when both Redis heartbeat and HTTP /health fail', async () => {
      process.env.ML_WORKER_URL = 'http://ml-worker:8000';
      redisMockGet.mockResolvedValue(null);
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { default: service } = await import('../services/mlPredictionService.js');
      const healthy = await service.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
