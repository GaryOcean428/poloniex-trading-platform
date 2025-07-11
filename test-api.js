#!/usr/bin/env node

/**
 * Test script to verify Poloniex V3 futures API endpoints
 */

import fetch from 'node-fetch';

const POLONIEX_API_BASE = 'https://api.poloniex.com/v3/futures';

async function testPublicEndpoints() {
  console.log('Testing Poloniex V3 futures API endpoints...');
  console.log(`Base URL: ${POLONIEX_API_BASE}`);
  
  // Test public endpoints that don't require authentication
  const endpoints = [
    '/market/ticker?symbol=BTC_USDT_PERP',
    '/market/candles?symbol=BTC_USDT_PERP&interval=1h&limit=10',
    '/market/orderbook?symbol=BTC_USDT_PERP&limit=10'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`\n📡 Testing: ${endpoint}`);
      const response = await fetch(`${POLONIEX_API_BASE}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      console.log(`📊 Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.text();
        console.log(`✅ Response (first 200 chars): ${data.substring(0, 200)}...`);
      } else {
        const errorData = await response.text();
        console.log(`❌ Error response: ${errorData}`);
      }
    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }
}

testPublicEndpoints()
  .then(() => {
    console.log('\n🏁 API endpoint testing completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  });