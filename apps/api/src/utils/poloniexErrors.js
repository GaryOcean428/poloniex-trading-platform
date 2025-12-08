import { logger } from './logger.js';

/**
 * Poloniex API Error Handling
 * Maps Poloniex error codes to user-friendly messages
 * Based on: https://api-docs.poloniex.com/spot/error-code
 */

// Custom error classes
export class PoloniexAPIError extends Error {
  constructor(message, code, statusCode, details = {}) {
    super(message);
    this.name = 'PoloniexAPIError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isRetryable = false;
  }
}

export class PoloniexAuthenticationError extends PoloniexAPIError {
  constructor(message, code, details) {
    super(message, code, 401, details);
    this.name = 'PoloniexAuthenticationError';
  }
}

export class PoloniexRateLimitError extends PoloniexAPIError {
  constructor(message, code, details) {
    super(message, code, 429, details);
    this.name = 'PoloniexRateLimitError';
    this.isRetryable = true;
    this.retryAfter = details.retryAfter || 1000;
  }
}

export class PoloniexInsufficientBalanceError extends PoloniexAPIError {
  constructor(message, code, details) {
    super(message, code, 400, details);
    this.name = 'PoloniexInsufficientBalanceError';
  }
}

export class PoloniexOrderError extends PoloniexAPIError {
  constructor(message, code, details) {
    super(message, code, 400, details);
    this.name = 'PoloniexOrderError';
  }
}

// Poloniex error code mappings
const ERROR_CODES = {
  // Authentication errors (401)
  '401': {
    message: 'Authentication failed',
    userMessage: 'Invalid API credentials. Please check your API key and secret.',
    type: PoloniexAuthenticationError
  },
  '10001': {
    message: 'Invalid signature',
    userMessage: 'API signature verification failed. Please check your API secret.',
    type: PoloniexAuthenticationError
  },
  '10002': {
    message: 'Invalid API key',
    userMessage: 'API key is invalid or has been revoked.',
    type: PoloniexAuthenticationError
  },
  '10003': {
    message: 'Timestamp expired',
    userMessage: 'Request timestamp is too old. Please check your system time.',
    type: PoloniexAuthenticationError
  },
  '10004': {
    message: 'Invalid timestamp',
    userMessage: 'Request timestamp is invalid.',
    type: PoloniexAuthenticationError
  },

  // Rate limiting (429)
  '429': {
    message: 'Rate limit exceeded',
    userMessage: 'Too many requests. Please slow down and try again.',
    type: PoloniexRateLimitError,
    isRetryable: true
  },
  '10005': {
    message: 'Rate limit exceeded',
    userMessage: 'API rate limit exceeded. Please wait before making more requests.',
    type: PoloniexRateLimitError,
    isRetryable: true
  },

  // Order errors (400)
  '20001': {
    message: 'Insufficient balance',
    userMessage: 'Insufficient balance to place this order.',
    type: PoloniexInsufficientBalanceError
  },
  '20002': {
    message: 'Invalid order quantity',
    userMessage: 'Order quantity is invalid or below minimum.',
    type: PoloniexOrderError
  },
  '20003': {
    message: 'Invalid order price',
    userMessage: 'Order price is invalid or outside allowed range.',
    type: PoloniexOrderError
  },
  '20004': {
    message: 'Order not found',
    userMessage: 'Order not found or already cancelled.',
    type: PoloniexOrderError
  },
  '20005': {
    message: 'Order already cancelled',
    userMessage: 'This order has already been cancelled.',
    type: PoloniexOrderError
  },
  '20006': {
    message: 'Order already filled',
    userMessage: 'This order has already been filled.',
    type: PoloniexOrderError
  },
  '20007': {
    message: 'Invalid symbol',
    userMessage: 'Trading pair is invalid or not supported.',
    type: PoloniexOrderError
  },
  '20008': {
    message: 'Market closed',
    userMessage: 'Market is currently closed for trading.',
    type: PoloniexOrderError
  },
  '20009': {
    message: 'Self-trade prevention',
    userMessage: 'Order would match with your own order.',
    type: PoloniexOrderError
  },
  '20010': {
    message: 'Post-only order would match',
    userMessage: 'Post-only order would be filled immediately.',
    type: PoloniexOrderError
  },

  // Account errors (400)
  '30001': {
    message: 'Account suspended',
    userMessage: 'Your account has been suspended. Please contact support.',
    type: PoloniexAPIError
  },
  '30002': {
    message: 'Account not verified',
    userMessage: 'Account verification required for this operation.',
    type: PoloniexAPIError
  },
  '30003': {
    message: 'Withdrawal disabled',
    userMessage: 'Withdrawals are currently disabled for your account.',
    type: PoloniexAPIError
  },

  // System errors (500)
  '500': {
    message: 'Internal server error',
    userMessage: 'Poloniex server error. Please try again later.',
    type: PoloniexAPIError,
    isRetryable: true
  },
  '503': {
    message: 'Service unavailable',
    userMessage: 'Poloniex service is temporarily unavailable.',
    type: PoloniexAPIError,
    isRetryable: true
  }
};

/**
 * Parse Poloniex API error response
 * @param {Object} error - Axios error object
 * @returns {PoloniexAPIError} - Parsed error
 */
export function parsePoloniexError(error) {
  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return new PoloniexAPIError(
      'Network connection failed',
      'NETWORK_ERROR',
      0,
      { originalError: error.message }
    );
  }

  // Timeout errors
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    const timeoutError = new PoloniexAPIError(
      'Request timeout',
      'TIMEOUT',
      0,
      { originalError: error.message }
    );
    timeoutError.isRetryable = true;
    return timeoutError;
  }

  // No response from server
  if (!error.response) {
    return new PoloniexAPIError(
      'No response from server',
      'NO_RESPONSE',
      0,
      { originalError: error.message }
    );
  }

  const { status, data } = error.response;
  
  // Try to extract error code from response
  const errorCode = data?.code || data?.error?.code || status.toString();
  const errorMessage = data?.message || data?.msg || data?.error?.message || 'Unknown error';

  // Look up error in our mapping
  const errorInfo = ERROR_CODES[errorCode] || ERROR_CODES[status.toString()];

  if (errorInfo) {
    const ErrorClass = errorInfo.type || PoloniexAPIError;
    const parsedError = new ErrorClass(
      errorInfo.message,
      errorCode,
      {
        originalMessage: errorMessage,
        userMessage: errorInfo.userMessage,
        ...data
      }
    );
    
    if (errorInfo.isRetryable) {
      parsedError.isRetryable = true;
    }

    return parsedError;
  }

  // Unknown error
  return new PoloniexAPIError(
    errorMessage,
    errorCode,
    status,
    { originalResponse: data }
  );
}

/**
 * Retry logic for retryable errors
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise} - Result of function
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = parsePoloniexError(error);
      
      // Don't retry if error is not retryable
      if (!lastError.isRetryable) {
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = lastError.retryAfter || (baseDelay * Math.pow(2, attempt));
      
      logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, {
        error: lastError.message,
        code: lastError.code
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Get user-friendly error message
 * @param {Error} error - Error object
 * @returns {string} - User-friendly message
 */
export function getUserFriendlyMessage(error) {
  if (error instanceof PoloniexAPIError) {
    return error.details.userMessage || error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Check if error is retryable
 * @param {Error} error - Error object
 * @returns {boolean} - Whether error is retryable
 */
export function isRetryableError(error) {
  if (error instanceof PoloniexAPIError) {
    return error.isRetryable;
  }
  
  // Network and timeout errors are retryable
  return error.code === 'ECONNREFUSED' || 
         error.code === 'ENOTFOUND' || 
         error.code === 'ECONNABORTED' || 
         error.code === 'ETIMEDOUT';
}

export default {
  PoloniexAPIError,
  PoloniexAuthenticationError,
  PoloniexRateLimitError,
  PoloniexInsufficientBalanceError,
  PoloniexOrderError,
  parsePoloniexError,
  retryWithBackoff,
  getUserFriendlyMessage,
  isRetryableError
};
