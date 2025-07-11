#!/usr/bin/env node

/**
 * Connectivity Test Script
 * Tests the WebSocket & API connectivity fixes
 */

import fetch from 'node-fetch';
import { WebSocket } from 'ws';

const TEST_URLS = {
  localBackend: 'http://localhost:3000',
  railwayBackend: 'https://polytrade-be.up.railway.app',
  railwayFrontend: 'https://poloniex-trading-platform-production.up.railway.app'
};

async function testHealthEndpoint(baseUrl) {
  console.log(`\n🔍 Testing health endpoint: ${baseUrl}`);
  
  try {
    // Test /api/health endpoint
    const apiHealthResponse = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (apiHealthResponse.ok) {
      const data = await apiHealthResponse.json();
      console.log(`✅ /api/health: ${apiHealthResponse.status} - ${data.status}`);
      console.log(`   Mode: ${data.mode}, Env: ${data.env}`);
      if (data.websocket) {
        console.log(`   WebSocket state: ${data.websocket.circuitBreakerState}`);
      }
    } else {
      console.log(`❌ /api/health: ${apiHealthResponse.status} ${apiHealthResponse.statusText}`);
    }
    
    // Test /health endpoint
    const healthResponse = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (healthResponse.ok) {
      const data = await healthResponse.json();
      console.log(`✅ /health: ${healthResponse.status} - ${data.status}`);
      console.log(`   Uptime: ${Math.floor(data.uptime)}s`);
    } else {
      console.log(`❌ /health: ${healthResponse.status} ${healthResponse.statusText}`);
    }
    
  } catch (error) {
    console.log(`❌ Health check failed: ${error.message}`);
  }
}

async function testCorsConfiguration(baseUrl, origin) {
  console.log(`\n🔍 Testing CORS from origin: ${origin}`);
  
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'GET',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    console.log(`✅ CORS request: ${response.status}`);
    
    // Check CORS headers
    const corsHeaders = {
      'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
      'access-control-allow-credentials': response.headers.get('access-control-allow-credentials'),
      'access-control-allow-methods': response.headers.get('access-control-allow-methods')
    };
    
    Object.entries(corsHeaders).forEach(([header, value]) => {
      if (value) {
        console.log(`   ${header}: ${value}`);
      }
    });
    
  } catch (error) {
    console.log(`❌ CORS test failed: ${error.message}`);
  }
}

async function testWebSocketConnection(baseUrl) {
  console.log(`\n🔍 Testing WebSocket connection: ${baseUrl}`);
  
  const wsUrl = baseUrl.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket';
  
  try {
    const ws = new WebSocket(wsUrl);
    
    const timeout = setTimeout(() => {
      console.log(`❌ WebSocket connection timeout`);
      ws.terminate();
    }, 10000);
    
    ws.on('open', () => {
      console.log(`✅ WebSocket connected successfully`);
      clearTimeout(timeout);
      ws.close();
    });
    
    ws.on('error', (error) => {
      console.log(`❌ WebSocket error: ${error.message}`);
      clearTimeout(timeout);
    });
    
    ws.on('close', () => {
      console.log(`📝 WebSocket connection closed`);
      clearTimeout(timeout);
    });
    
  } catch (error) {
    console.log(`❌ WebSocket test failed: ${error.message}`);
  }
}

async function runConnectivityTests() {
  console.log('🚀 WebSocket & API Connectivity Test Suite');
  console.log('==========================================');
  
  // Test local backend if available
  console.log('\n📍 Testing Local Backend');
  await testHealthEndpoint(TEST_URLS.localBackend);
  
  // Test Railway backend
  console.log('\n📍 Testing Railway Backend');
  await testHealthEndpoint(TEST_URLS.railwayBackend);
  
  // Test CORS configurations
  console.log('\n📍 Testing CORS Configuration');
  await testCorsConfiguration(TEST_URLS.railwayBackend, TEST_URLS.railwayFrontend);
  await testCorsConfiguration(TEST_URLS.railwayBackend, 'http://localhost:5173');
  
  // Test WebSocket connections
  console.log('\n📍 Testing WebSocket Connections');
  await testWebSocketConnection(TEST_URLS.railwayBackend);
  
  console.log('\n✨ Connectivity tests completed!');
  console.log('\n📋 Configuration Summary:');
  console.log(`   Frontend URL: ${TEST_URLS.railwayFrontend}`);
  console.log(`   Backend URL: ${TEST_URLS.railwayBackend}`);
  console.log(`   Health Check: ${TEST_URLS.railwayBackend}/api/health`);
  console.log(`   WebSocket: wss://polytrade-be.up.railway.app/socket.io/`);
}

// Run the tests
runConnectivityTests().catch(console.error);