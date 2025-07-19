#!/usr/bin/env node

/**
 * Test script to verify Poloniex V3 futures WebSocket connectivity
 */

import WebSocket from 'ws';

// Get WebSocket token for V3 API
const getBulletToken = async () => {
  try {
    const response = await globalThis.fetch('https://futures-api.poloniex.com/api/v1/bullet-public', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get bullet token: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.data && data.data.token) {
      return {
        token: data.data.token,
        endpoint: data.data.instanceServers[0].endpoint
      };
    } else {
      throw new Error('Invalid bullet token response format');
    }
  } catch (error) {
    console.error('Failed to get bullet token:', error);
    throw error;
  }
};

console.log('Testing Poloniex V3 futures WebSocket connection...');
console.log('Getting bullet token...');

const { token, endpoint } = await getBulletToken();
const POLONIEX_WS_URL = `${endpoint}?token=${token}`;

console.log(`Connecting to: ${endpoint}`);

const ws = new WebSocket(POLONIEX_WS_URL);

ws.on('open', () => {
  console.log('✅ Connected to Poloniex V3 futures WebSocket');
  
  // Subscribe to ticker data using V3 format
  const subscribeMessage = {
    id: Date.now(),
    type: 'subscribe',
    topic: '/contractMarket/ticker:BTCUSDTPERP',
    response: true
  };
  
  console.log('📡 Subscribing to ticker channels:', subscribeMessage);
  ws.send(JSON.stringify(subscribeMessage));
  
  // Close connection after 10 seconds
  setTimeout(() => {
    console.log('🔌 Closing connection...');
    ws.close();
  }, 10000);
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('📨 Received message:', JSON.stringify(message, null, 2));
  } catch (error) {
    console.log('📨 Received raw message:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔚 Connection closed: ${code} - ${reason || 'No reason provided'}`);
  process.exit(0);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚡ Interrupted, closing connection...');
  ws.close();
});