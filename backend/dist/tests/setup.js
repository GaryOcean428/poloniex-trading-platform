/**
 * Jest Test Setup
 * Runs before all tests
 */
// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
// Increase timeout for integration tests
// @ts-expect-error - jest types not available in test setup
if (typeof jest !== 'undefined')
    jest.setTimeout(30000);
// Suppress console logs during tests (optional)
// @ts-expect-error - jest types not available in test setup
if (process.env.SUPPRESS_TEST_LOGS === 'true' && typeof jest !== 'undefined') {
    global.console = {
        ...console,
        // @ts-expect-error - jest types not available in test setup
        log: jest.fn(),
        // @ts-expect-error - jest types not available in test setup
        info: jest.fn(),
        // @ts-expect-error - jest types not available in test setup
        warn: jest.fn(),
        // @ts-expect-error - jest types not available in test setup
        error: jest.fn(),
    };
}
