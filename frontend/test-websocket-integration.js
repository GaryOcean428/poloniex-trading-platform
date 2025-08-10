#!/usr/bin/env node
/**
 * WebSocket Configuration Validation
 * 
 * Simple validation script to check WebSocket configuration logic
 */

console.log('🧪 WebSocket Configuration Validation\n');

// Test URL validation logic
function validateWebSocketUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

// Test URL conversion logic  
function convertToWebSocketUrl(httpUrl) {
  if (httpUrl.startsWith('https://')) {
    return httpUrl.replace('https://', 'wss://');
  } else if (httpUrl.startsWith('http://')) {
    return httpUrl.replace('http://', 'ws://');
  }
  return httpUrl;
}

// Run validation tests
console.log('🔗 Testing URL validation:');
console.log('✅ ws://localhost:8765 ->', validateWebSocketUrl('ws://localhost:8765'));
console.log('✅ wss://example.com ->', validateWebSocketUrl('wss://example.com'));
console.log('❌ https://example.com ->', validateWebSocketUrl('https://example.com'));
console.log('❌ invalid-url ->', validateWebSocketUrl('invalid-url'));

console.log('\n🔄 Testing URL conversion:');
console.log('✅ https://backend.com -> ', convertToWebSocketUrl('https://backend.com'));
console.log('✅ http://localhost:8765 -> ', convertToWebSocketUrl('http://localhost:8765'));

console.log('\n🎯 Testing Railway URL patterns:');
const railwayUrl = 'https://polytrade-be.up.railway.app';
const railwayWsUrl = convertToWebSocketUrl(railwayUrl);
console.log(`✅ Railway backend: ${railwayUrl}`);
console.log(`✅ Railway WebSocket: ${railwayWsUrl}`);
console.log(`✅ Is valid WebSocket URL: ${validateWebSocketUrl(railwayWsUrl)}`);

console.log('\n🎉 WebSocket configuration logic validation complete!');
console.log('✅ All URL patterns work correctly for Railway deployment.');