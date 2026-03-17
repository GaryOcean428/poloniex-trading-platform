/**
 * Unit tests for LLMStrategyGenerator
 * Tests Claude 4.6 request shape, adaptive thinking, prompt caching, Zod validation,
 * refusal handling, and optional field defaulting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK *before* importing the module under test so the
// import-time constructor in LLMStrategyGenerator picks up the mock client.
// ---------------------------------------------------------------------------
const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  const AnthropicMock = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate
    }
  }));
  return { default: AnthropicMock };
});

// Mock logger to suppress output
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------
import { LLMStrategyGenerator } from '../services/llmStrategyGenerator.js';
import type { MarketContext } from '../services/llmStrategyGenerator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid strategy JSON that Claude would return */
const makeValidStrategyJson = (overrides: Record<string, unknown> = {}): string => {
  const strategy = {
    name: 'Test Momentum Strategy',
    description: 'A test strategy for unit testing',
    type: 'momentum',
    algorithm: 'RSI_Momentum',
    parameters: {
      pair: 'BTC-USDT',
      timeframe: '1h',
      indicators: { rsi_period: 14 }
    },
    entryConditions: ['RSI > 60', 'Volume > 1.5x average'],
    exitConditions: ['RSI < 40', 'Stop loss -2%'],
    riskManagement: {
      stopLossPercent: 2.0,
      takeProfitPercent: 5.0,
      maxPositionSize: 0.1,
      maxDrawdown: 0.15
    },
    expectedPerformance: {
      winRate: 0.55,
      profitFactor: 1.8,
      sharpeRatio: 1.2
    },
    confidence: 75,
    reasoning: 'Strong momentum indicators',
    ...overrides
  };
  return JSON.stringify(strategy);
};

/** Minimal market context for tests */
const makeMarketContext = (overrides: Partial<MarketContext> = {}): MarketContext => ({
  symbol: 'BTC-USDT',
  currentPrice: 50000,
  priceChange24h: 2.5,
  volume24h: 1000000,
  technicalIndicators: { rsi: 65 },
  marketRegime: 'trending_up',
  sentiment: 'bullish',
  ...overrides
});

/** Build a mock Claude response with a text block containing the given JSON */
const makeMockResponse = (jsonContent: string, stopReason = 'end_turn') => ({
  stop_reason: stopReason,
  content: [
    { type: 'thinking', thinking: 'Some internal thinking...' },
    { type: 'text', text: jsonContent }
  ]
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LLMStrategyGenerator', () => {
  let generator: LLMStrategyGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    // Provide a fake API key so the constructor initializes the client
    process.env.ANTHROPIC_API_KEY = 'test-api-key-abc123';
    generator = new LLMStrategyGenerator();
  });

  // -------------------------------------------------------------------------
  // generateStrategy – request shape
  // -------------------------------------------------------------------------
  describe('generateStrategy() request shape', () => {
    it('sends model: "claude-sonnet-4-6"', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.generateStrategy(makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-6');
    });

    it('sends thinking: { type: "adaptive" }', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.generateStrategy(makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.thinking).toEqual({ type: 'adaptive' });
    });

    it('sends effort: "medium"', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.generateStrategy(makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.effort).toBe('medium');
    });

    it('includes cache_control: { type: "ephemeral" } on the system prompt', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.generateStrategy(makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      const systemBlock = callArgs.system?.[0];
      expect(systemBlock?.cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  // -------------------------------------------------------------------------
  // optimizeStrategy – request shape
  // -------------------------------------------------------------------------
  describe('optimizeStrategy() request shape', () => {
    const mockStrategy = {
      id: '1',
      name: 'Existing Strategy',
      type: 'trend_following' as const,
      algorithm: 'EMA_Cross',
      parameters: { pair: 'BTC-USDT', timeframe: '1h' },
      description: 'An existing strategy',
      entryConditions: ['EMA cross'],
      exitConditions: ['EMA cross reverse'],
      riskManagement: {
        stopLossPercent: 2,
        takeProfitPercent: 5,
        maxPositionSize: 0.1,
        maxDrawdown: 0.15
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const mockPerformance = {
      winRate: 0.45,
      profitFactor: 1.2,
      sharpeRatio: 0.9,
      maxDrawdown: 0.20,
      totalTrades: 100
    };

    it('sends model: "claude-sonnet-4-6"', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.optimizeStrategy(mockStrategy, mockPerformance, makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-6');
    });

    it('sends thinking: { type: "adaptive" }', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.optimizeStrategy(mockStrategy, mockPerformance, makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.thinking).toEqual({ type: 'adaptive' });
    });

    it('sends effort: "medium"', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.optimizeStrategy(mockStrategy, mockPerformance, makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.effort).toBe('medium');
    });

    it('includes cache_control: { type: "ephemeral" } on the system prompt', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      await generator.optimizeStrategy(mockStrategy, mockPerformance, makeMarketContext());

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      const systemBlock = callArgs.system?.[0];
      expect(systemBlock?.cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  // -------------------------------------------------------------------------
  // Refusal handling
  // -------------------------------------------------------------------------
  describe('refusal stop reason', () => {
    it('throws a meaningful error when stop_reason is "refusal"', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        stop_reason: 'refusal',
        content: []
      });

      await expect(generator.generateStrategy(makeMarketContext())).rejects.toThrow(
        'Claude declined to generate this strategy for safety reasons'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Schema validation
  // -------------------------------------------------------------------------
  describe('Zod schema validation', () => {
    it('parses a valid strategy response successfully', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse(makeValidStrategyJson())
      );

      const result = await generator.generateStrategy(makeMarketContext());

      expect(result.name).toBe('Test Momentum Strategy');
      expect(result.type).toBe('momentum');
    });

    it('throws when the LLM response is not valid JSON', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeMockResponse('This is not JSON at all')
      );

      await expect(generator.generateStrategy(makeMarketContext())).rejects.toThrow(
        'Failed to parse LLM response'
      );
    });

    it('throws when required fields (name) are missing', async () => {
      const invalidJson = makeValidStrategyJson({ name: undefined });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(invalidJson));

      await expect(generator.generateStrategy(makeMarketContext())).rejects.toThrow(
        'Failed to parse LLM response'
      );
    });

    it('throws when entryConditions is empty', async () => {
      const invalidJson = makeValidStrategyJson({ entryConditions: [] });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(invalidJson));

      await expect(generator.generateStrategy(makeMarketContext())).rejects.toThrow(
        'Failed to parse LLM response'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Optional field defaults
  // -------------------------------------------------------------------------
  describe('optional field defaults', () => {
    it('defaults parameters.pair to market symbol when omitted', async () => {
      const withoutPair = makeValidStrategyJson({
        parameters: { timeframe: '4h', indicators: {} }
      });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(withoutPair));

      const result = await generator.generateStrategy(makeMarketContext({ symbol: 'ETH-USDT' }));

      expect(result.parameters.pair).toBe('ETH-USDT');
    });

    it('defaults parameters.timeframe to "1h" when omitted', async () => {
      const withoutTimeframe = makeValidStrategyJson({
        parameters: { pair: 'BTC-USDT', indicators: {} }
      });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(withoutTimeframe));

      const result = await generator.generateStrategy(makeMarketContext());

      expect(result.parameters.timeframe).toBe('1h');
    });

    it('defaults expectedPerformance when omitted', async () => {
      const withoutPerf = makeValidStrategyJson({ expectedPerformance: undefined });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(withoutPerf));

      const result = await generator.generateStrategy(makeMarketContext());

      expect(result.expectedPerformance).toEqual({
        winRate: 0.50,
        profitFactor: 1.5,
        sharpeRatio: 1.0
      });
    });

    it('defaults confidence to 70 when omitted', async () => {
      const withoutConfidence = makeValidStrategyJson({ confidence: undefined });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(withoutConfidence));

      const result = await generator.generateStrategy(makeMarketContext());

      expect(result.confidence).toBe(70);
    });

    it('defaults reasoning to "LLM-generated strategy" when omitted', async () => {
      const withoutReasoning = makeValidStrategyJson({ reasoning: undefined });
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(withoutReasoning));

      const result = await generator.generateStrategy(makeMarketContext());

      expect(result.reasoning).toBe('LLM-generated strategy');
    });
  });

  // -------------------------------------------------------------------------
  // JSON extraction from markdown code blocks
  // -------------------------------------------------------------------------
  describe('JSON extraction', () => {
    it('extracts JSON wrapped in ```json code block', async () => {
      const jsonStr = makeValidStrategyJson();
      const wrappedInCodeBlock = `Here is the strategy:\n\`\`\`json\n${jsonStr}\n\`\`\``;
      mockMessagesCreate.mockResolvedValueOnce(makeMockResponse(wrappedInCodeBlock));

      const result = await generator.generateStrategy(makeMarketContext());

      expect(result.name).toBe('Test Momentum Strategy');
    });
  });
});
