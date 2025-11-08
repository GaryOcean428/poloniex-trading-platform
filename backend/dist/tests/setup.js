/**
 * Jest Test Setup
 * Runs before all tests
 */
// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
// Increase timeout for integration tests
// @ts-ignore
if (typeof jest !== 'undefined')
    jest.setTimeout(30000);
// Suppress console logs during tests (optional)
// @ts-ignore
if (process.env.SUPPRESS_TEST_LOGS === 'true' && typeof jest !== 'undefined') {
    // @ts-ignore
    global.console = {
        ...console,
        // @ts-ignore
        log: jest.fn(),
        // @ts-ignore
        info: jest.fn(),
        // @ts-ignore
        warn: jest.fn(),
        // @ts-ignore
        error: jest.fn(),
    };
}
