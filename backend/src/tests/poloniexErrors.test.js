import { describe, it, expect } from 'vitest';
import {
  PoloniexAPIError,
  PoloniexAuthenticationError,
  PoloniexRateLimitError,
  PoloniexInsufficientBalanceError,
  PoloniexOrderError,
  parsePoloniexError,
  getUserFriendlyMessage,
  isRetryableError
} from '../utils/poloniexErrors.js';

describe('PoloniexErrors', () => {
  describe('Error Classes', () => {
    it('should create PoloniexAPIError', () => {
      const error = new PoloniexAPIError('Test error', '500', 500);
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PoloniexAPIError);
      expect(error.name).toBe('PoloniexAPIError');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('500');
      expect(error.statusCode).toBe(500);
      expect(error.isRetryable).toBe(false);
    });

    it('should create PoloniexAuthenticationError', () => {
      const error = new PoloniexAuthenticationError('Auth failed', '401', {});
      
      expect(error).toBeInstanceOf(PoloniexAPIError);
      expect(error.name).toBe('PoloniexAuthenticationError');
      expect(error.statusCode).toBe(401);
    });

    it('should create PoloniexRateLimitError', () => {
      const error = new PoloniexRateLimitError('Rate limit', '429', {});
      
      expect(error).toBeInstanceOf(PoloniexAPIError);
      expect(error.name).toBe('PoloniexRateLimitError');
      expect(error.statusCode).toBe(429);
      expect(error.isRetryable).toBe(true);
    });

    it('should create PoloniexInsufficientBalanceError', () => {
      const error = new PoloniexInsufficientBalanceError('No balance', '20001', {});
      
      expect(error).toBeInstanceOf(PoloniexAPIError);
      expect(error.name).toBe('PoloniexInsufficientBalanceError');
    });

    it('should create PoloniexOrderError', () => {
      const error = new PoloniexOrderError('Order failed', '20002', {});
      
      expect(error).toBeInstanceOf(PoloniexAPIError);
      expect(error.name).toBe('PoloniexOrderError');
    });
  });

  describe('parsePoloniexError', () => {
    it('should parse network errors', () => {
      const networkError = {
        code: 'ECONNREFUSED',
        message: 'Connection refused'
      };
      
      const parsed = parsePoloniexError(networkError);
      
      expect(parsed).toBeInstanceOf(PoloniexAPIError);
      expect(parsed.code).toBe('NETWORK_ERROR');
    });

    it('should parse timeout errors', () => {
      const timeoutError = {
        code: 'ETIMEDOUT',
        message: 'Request timeout'
      };
      
      const parsed = parsePoloniexError(timeoutError);
      
      expect(parsed).toBeInstanceOf(PoloniexAPIError);
      expect(parsed.code).toBe('TIMEOUT');
      expect(parsed.isRetryable).toBe(true);
    });

    it('should parse authentication errors', () => {
      const authError = {
        response: {
          status: 401,
          data: {
            code: '10001',
            message: 'Invalid signature'
          }
        }
      };
      
      const parsed = parsePoloniexError(authError);
      
      expect(parsed).toBeInstanceOf(PoloniexAuthenticationError);
      expect(parsed.code).toBe('10001');
    });

    it('should parse rate limit errors', () => {
      const rateLimitError = {
        response: {
          status: 429,
          data: {
            code: '429',
            message: 'Too many requests'
          }
        }
      };
      
      const parsed = parsePoloniexError(rateLimitError);
      
      expect(parsed).toBeInstanceOf(PoloniexRateLimitError);
      expect(parsed.isRetryable).toBe(true);
    });

    it('should parse insufficient balance errors', () => {
      const balanceError = {
        response: {
          status: 400,
          data: {
            code: '20001',
            message: 'Insufficient balance'
          }
        }
      };
      
      const parsed = parsePoloniexError(balanceError);
      
      expect(parsed).toBeInstanceOf(PoloniexInsufficientBalanceError);
    });

    it('should parse order errors', () => {
      const orderError = {
        response: {
          status: 400,
          data: {
            code: '20002',
            message: 'Invalid order quantity'
          }
        }
      };
      
      const parsed = parsePoloniexError(orderError);
      
      expect(parsed).toBeInstanceOf(PoloniexOrderError);
    });

    it('should handle unknown errors', () => {
      const unknownError = {
        response: {
          status: 500,
          data: {
            code: '99999',
            message: 'Unknown error'
          }
        }
      };
      
      const parsed = parsePoloniexError(unknownError);
      
      expect(parsed).toBeInstanceOf(PoloniexAPIError);
      expect(parsed.code).toBe('99999');
    });

    it('should handle errors without response', () => {
      const noResponseError = {
        message: 'No response from server'
      };
      
      const parsed = parsePoloniexError(noResponseError);
      
      expect(parsed).toBeInstanceOf(PoloniexAPIError);
      expect(parsed.code).toBe('NO_RESPONSE');
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return user-friendly message for PoloniexAPIError', () => {
      const error = new PoloniexAPIError('Test error', '500', 500, {
        userMessage: 'Something went wrong'
      });
      
      const message = getUserFriendlyMessage(error);
      
      expect(message).toBe('Something went wrong');
    });

    it('should return default message for unknown errors', () => {
      const error = new Error('Unknown error');
      
      const message = getUserFriendlyMessage(error);
      
      expect(message).toBe('An unexpected error occurred. Please try again.');
    });

    it('should return error message if no user message', () => {
      const error = new PoloniexAPIError('Test error', '500', 500);
      
      const message = getUserFriendlyMessage(error);
      
      expect(message).toBe('Test error');
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable PoloniexAPIError', () => {
      const error = new PoloniexAPIError('Test', '500', 500);
      error.isRetryable = true;
      
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify non-retryable PoloniexAPIError', () => {
      const error = new PoloniexAPIError('Test', '400', 400);
      error.isRetryable = false;
      
      expect(isRetryableError(error)).toBe(false);
    });

    it('should identify network errors as retryable', () => {
      const error = { code: 'ECONNREFUSED' };
      
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify timeout errors as retryable', () => {
      const error = { code: 'ETIMEDOUT' };
      
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify non-network errors as non-retryable', () => {
      const error = new Error('Regular error');
      
      expect(isRetryableError(error)).toBe(false);
    });
  });
});
