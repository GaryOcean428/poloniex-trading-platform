#!/usr/bin/env node

/**
 * Test WebSocket Connection
 *
 * This script tests the WebSocket connection configuration to ensure
 * that the backend URL is properly resolved and accessible.
 */

import { io } from 'socket.io-client';

console.log('🧪 Testing WebSocket connection configuration...');

// Test the backend URL resolution
const backendUrl = 'https://polytrade-be.up.railway.app';
console.log(`🔗 Testing connection to: ${backendUrl}`);

// Test HTTP health endpoint first
console.log('🏥 Testing HTTP health endpoint...');

try {
  const response = await fetch(`${backendUrl}/api/health`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });

  if (response.ok) {
    const healthData = await response.json();
    console.log('✅ HTTP health check passed');
    console.log(`📊 Backend status: ${healthData.status}`);
    console.log(`🗄️  Database: ${healthData.database ? 'Connected' : 'Disconnected'}`);
    console.log(`🔗 Redis: ${healthData.redis?.healthy ? 'Connected' : 'Disconnected'}`);
  } else {
    console.log(`❌ HTTP health check failed: ${response.status} ${response.statusText}`);
  }
} catch (error) {
  console.log(`❌ HTTP health check error: ${error.message}`);
}

// Test WebSocket connection
console.log('\n🔌 Testing WebSocket connection...');

const socket = io(backendUrl, {
  transports: ['websocket', 'polling'],
  timeout: 10000,
  reconnectionAttempts: 3,
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  console.log('✅ WebSocket connected successfully!');
  console.log(`🆔 Socket ID: ${socket.id}`);

  // Test a simple ping
  socket.emit('ping', { timestamp: Date.now() });
});

socket.on('pong', (data) => {
  console.log('🏓 Ping/pong test successful');
  console.log(`⏱️  Latency: ${Date.now() - data.timestamp}ms`);

  // Clean up and exit
  socket.disconnect();
  console.log('\n✅ All WebSocket tests passed!');
  console.log('🎉 The login and registration should now work correctly.');
  process.exit(0);
});

socket.on('connect_error', (error) => {
  console.log(`❌ WebSocket connection failed: ${error.message}`);

  // Check if it's the template resolution issue
  if (error.message.includes('polytrade-be.railway_public_domain')) {
    console.log('🔍 Detected unresolved template variable issue!');
    console.log('💡 The frontend build needs to be redeployed with the fixed configuration.');
  }

  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log(`🔌 WebSocket disconnected: ${reason}`);
});

// Timeout after 15 seconds
setTimeout(() => {
  console.log('⏰ Connection test timed out');
  console.log('📝 This might indicate network issues or backend unavailability');
  socket.disconnect();
  process.exit(1);
}, 15000);

console.log('⏳ Attempting connection (timeout: 15s)...');
