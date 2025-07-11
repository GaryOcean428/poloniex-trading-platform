#!/usr/bin/env node

/**
 * Test script to verify Poloniex V3 futures WebSocket connectivity
 */

import WebSocket from 'ws';

const POLONIEX_WS_URL = 'wss://ws.poloniex.com/ws/public';

console.log('Testing Poloniex V3 futures WebSocket connection...');
console.log(`Connecting to: ${POLONIEX_WS_URL}`);

const ws = new WebSocket(POLONIEX_WS_URL);

ws.on('open', () => {
  console.log('✅ Connected to Poloniex V3 futures WebSocket');
  
  // Subscribe to ticker data
  const subscribeMessage = {
    event: 'subscribe',
    channel: ['ticker'],
    symbols: ['BTC_USDT', 'ETH_USDT']
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