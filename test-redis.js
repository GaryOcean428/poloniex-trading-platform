#!/usr/bin/env node
import Redis from 'redis';

// Test Redis connection using Railway environment variables
const redisUrl = process.env.REDIS_URL || 'redis://default:KDjTgzmkEAwAxzCwUGdBCfExWlLWOPVo@redis-stack.railway.internal:6379';

console.log('Testing Redis connection...');
console.log('REDIS_URL:', redisUrl);

const client = Redis.createClient({
  url: redisUrl
});

client.on('error', (err) => {
  console.error('Redis Client Error:', err);
  process.exit(1);
});

client.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

client.on('ready', () => {
  console.log('✅ Redis ready');

  // Test basic operations
  client.set('test-key', 'Hello from Railway Redis!', (err, reply) => {
    if (err) {
      console.error('SET error:', err);
    } else {
      console.log('SET result:', reply);

      client.get('test-key', (err, value) => {
        if (err) {
          console.error('GET error:', err);
        } else {
          console.log('GET result:', value);
          console.log('✅ Redis operations working correctly');
        }
        client.quit();
      });
    }
  });
});

client.connect();
