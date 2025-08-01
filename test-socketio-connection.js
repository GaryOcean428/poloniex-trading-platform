#!/usr/bin/env node

/**
 * Test script to verify Socket.IO connection between frontend and backend
 */

import { io } from 'socket.io-client';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8765';

console.log('Testing Socket.IO connection...');
console.log(`Connecting to: ${BACKEND_URL}`);

const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  timeout: 10000,
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  console.log('✅ Connected to Socket.IO server');
  console.log(`Socket ID: ${socket.id}`);
  
  // Test health check
  console.log('📡 Sending health check...');
  socket.emit('health-check');
  
  // Test market data subscription
  console.log('📡 Testing market data subscription...');
  socket.emit('subscribe-market-data', { symbol: 'BTCUSD' });
  
  // Close connection after 5 seconds
  setTimeout(() => {
    console.log('🔌 Closing connection...');
    socket.disconnect();
  }, 5000);
});

socket.on('health-response', (data) => {
  console.log('📨 Health response received:', data);
});

socket.on('market-data-subscribed', (data) => {
  console.log('📨 Market data subscription confirmed:', data);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log(`🔚 Disconnected: ${reason}`);
  process.exit(0);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚡ Interrupted, closing connection...');
  socket.disconnect();
});