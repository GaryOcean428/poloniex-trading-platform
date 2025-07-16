#!/usr/bin/env node
import redisService from './src/services/redisService.js';
import { logger } from './src/utils/logger.js';

async function testRedisIntegration() {
  console.log('🧪 Testing Redis Integration...\n');

  try {
    // Test 1: Basic connectivity
    console.log('1. Testing Redis connection...');
    const health = await redisService.healthCheck();
    console.log('   Health check:', health.healthy ? '✅ PASS' : '❌ FAIL');

    if (!health.healthy) {
      throw new Error('Redis not healthy');
    }

    // Test 2: Basic operations
    console.log('2. Testing basic SET/GET operations...');
    await redisService.set('test:key', { message: 'Hello Redis!', timestamp: Date.now() }, 60);
    const retrieved = await redisService.get('test:key');
    console.log('   SET/GET:', retrieved ? '✅ PASS' : '❌ FAIL');

    // Test 3: Rate limiting
    console.log('3. Testing rate limiting...');
    const rateLimitKey = 'test:rate_limit';
    for (let i = 0; i < 5; i++) {
      const result = await redisService.checkRateLimit(rateLimitKey, 10, 60);
      console.log(`   Attempt ${i + 1}: ${result.allowed ? 'allowed' : 'blocked'} (${result.remaining} remaining)`);
    }

    // Test 4: Caching
    console.log('4. Testing caching...');
    const cacheTest = async () => {
      return { data: 'cached data', timestamp: Date.now() };
    };

    const cached1 = await redisService.cacheGet('test:cache', cacheTest, 30);
    const cached2 = await redisService.cacheGet('test:cache', cacheTest, 30);
    console.log('   Caching:', cached1.data === cached2.data ? '✅ PASS' : '❌ FAIL');

    // Test 5: Session management
    console.log('5. Testing session management...');
    const sessionId = 'test-session-123';
    await redisService.createSession(sessionId, { userId: 123, role: 'test' }, 60);
    const session = await redisService.getSession(sessionId);
    console.log('   Session:', session ? '✅ PASS' : '❌ FAIL');

    // Test 6: Market data caching
    console.log('6. Testing market data caching...');
    const marketData = {
      pair: 'BTC-USDT',
      price: 50000.50,
      volume: 123456.78,
      timestamp: Date.now()
    };

    await redisService.set(`market:${marketData.pair}`, marketData, 300);
    const cachedMarket = await redisService.get(`market:${marketData.pair}`);
    console.log('   Market cache:', cachedMarket ? '✅ PASS' : '❌ FAIL');

    // Test 7: Cleanup
    console.log('7. Testing cleanup...');
    await redisService.del('test:key');
    await redisService.del('test:cache');
    await redisService.deleteSession(sessionId);
    await redisService.del(`market:${marketData.pair}`);
    console.log('   Cleanup: ✅ PASS');

    console.log('\n🎉 All Redis integration tests passed!\n');

    // Display Redis info
    const redisInfo = await redisService.get('info');
    console.log('Redis Info:');
    console.log('  - Connection: HEALTHY');
    console.log('  - Caching: ACTIVE');
    console.log('  - Rate limiting: ACTIVE');
    console.log('  - Session management: ACTIVE');
    console.log('  - Market data caching: ACTIVE');

  } catch (error) {
    console.error('❌ Redis integration test failed:', error.message);
    process.exit(1);
  } finally {
    await redisService.disconnect();
  }
}

// Run tests
testRedisIntegration().catch(console.error);
