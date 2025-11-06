/**
 * Jest Test Setup
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Suppress console logs during tests (optional)
if (process.env.SUPPRESS_TEST_LOGS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}
