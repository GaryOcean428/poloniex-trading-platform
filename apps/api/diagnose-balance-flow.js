/**
 * Comprehensive Balance Display Diagnostic Script
 * 
 * This script diagnoses the complete data flow from database to frontend
 * for balance display, identifying all points of failure.
 * 
 * Run with: node diagnose-balance-flow.js
 */

import pkg from 'pg';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'cyan');
  console.log('='.repeat(80));
}

// Test user ID (replace with actual user ID)
const TEST_USER_ID = '7e989bb1-9bbf-442d-a778-2086cd27d6ab'; // GaryOcean

async function testDatabaseConnection() {
  section('1. DATABASE CONNECTION TEST');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });

  try {
    log('Testing database connection...', 'blue');
    const client = await pool.connect();
    const result = await client.query('SELECT NOW(), version()');
    log('✅ Database connected successfully', 'green');
    log(`   Time: ${result.rows[0].now}`, 'green');
    log(`   Version: ${result.rows[0].version.substring(0, 50)}...`, 'green');
    client.release();
    
    return { success: true, pool };
  } catch (error) {
    log('❌ Database connection failed', 'red');
    log(`   Error: ${error.message}`, 'red');
    log(`   Code: ${error.code}`, 'red');
    
    // Provide specific fixes
    if (error.code === 'ECONNRESET') {
      log('\n🔧 FIX: Database connection is being reset', 'yellow');
      log('   Possible causes:', 'yellow');
      log('   1. Railway database is sleeping/restarting', 'yellow');
      log('   2. Connection pool exhausted', 'yellow');
      log('   3. Network instability', 'yellow');
      log('   4. SSL/TLS handshake failure', 'yellow');
      log('\n   Solutions:', 'yellow');
      log('   - Increase connection timeout', 'yellow');
      log('   - Enable connection keepalive', 'yellow');
      log('   - Reduce max pool size', 'yellow');
      log('   - Add retry logic with exponential backoff', 'yellow');
    }
    
    return { success: false, error };
  } finally {
    await pool.end();
  }
}

async function testApiCredentialsRetrieval(pool) {
  section('2. API CREDENTIALS RETRIEVAL TEST');
  
  try {
    log(`Testing credentials retrieval for user: ${TEST_USER_ID}`, 'blue');
    
    // Check if credentials exist
    const checkResult = await pool.query(
      `SELECT id, user_id, exchange, is_active, 
              encryption_iv, encryption_tag, 
              created_at, updated_at, last_used_at
       FROM api_credentials
       WHERE user_id = $1`,
      [TEST_USER_ID]
    );
    
    if (checkResult.rows.length === 0) {
      log('❌ No credentials found in database', 'red');
      log('\n🔧 FIX: User needs to add API credentials', 'yellow');
      log('   1. Go to Settings page', 'yellow');
      log('   2. Enter Poloniex API Key and Secret', 'yellow');
      log('   3. Click Save', 'yellow');
      return { success: false, reason: 'no_credentials' };
    }
    
    log(`✅ Found ${checkResult.rows.length} credential(s)`, 'green');
    
    for (const cred of checkResult.rows) {
      log(`\n   Credential Details:`, 'green');
      log(`   - Exchange: ${cred.exchange}`, 'green');
      log(`   - Active: ${cred.is_active}`, 'green');
      log(`   - Has IV: ${!!cred.encryption_iv}`, 'green');
      log(`   - Has Tag: ${!!cred.encryption_tag}`, 'green');
      log(`   - Created: ${cred.created_at}`, 'green');
      log(`   - Last Used: ${cred.last_used_at || 'Never'}`, 'green');
      
      if (!cred.encryption_tag) {
        log('   ⚠️  WARNING: Missing encryption_tag', 'yellow');
        log('   This credential cannot be decrypted', 'yellow');
        log('\n🔧 FIX: Re-enter API credentials', 'yellow');
        log('   The encryption format has been updated', 'yellow');
        return { success: false, reason: 'missing_encryption_tag' };
      }
      
      if (!cred.is_active) {
        log('   ⚠️  WARNING: Credential is inactive', 'yellow');
        log('\n🔧 FIX: Re-enter API credentials to activate', 'yellow');
        return { success: false, reason: 'inactive_credential' };
      }
    }
    
    return { success: true, credentials: checkResult.rows };
  } catch (error) {
    log('❌ Failed to retrieve credentials', 'red');
    log(`   Error: ${error.message}`, 'red');
    return { success: false, error };
  }
}

async function testCredentialDecryption(pool) {
  section('3. CREDENTIAL DECRYPTION TEST');
  
  try {
    log('Testing credential decryption...', 'blue');
    
    const result = await pool.query(
      `SELECT api_key_encrypted, api_secret_encrypted, encryption_iv, encryption_tag
       FROM api_credentials
       WHERE user_id = $1 AND is_active = true
       LIMIT 1`,
      [TEST_USER_ID]
    );
    
    if (result.rows.length === 0) {
      log('❌ No active credentials to decrypt', 'red');
      return { success: false, reason: 'no_active_credentials' };
    }
    
    const stored = result.rows[0];
    
    // Check encryption key
    const encryptionKey = process.env.API_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!encryptionKey) {
      log('❌ No encryption key found in environment', 'red');
      log('\n🔧 FIX: Set API_ENCRYPTION_KEY or JWT_SECRET', 'yellow');
      return { success: false, reason: 'no_encryption_key' };
    }
    
    log('✅ Encryption key found', 'green');
    
    // Test decryption
    try {
      const masterKey = crypto.scryptSync(encryptionKey, 'salt', 32);
      const ivBuffer = Buffer.from(stored.encryption_iv, 'hex');
      const tagBuffer = Buffer.from(stored.encryption_tag, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, ivBuffer);
      decipher.setAuthTag(tagBuffer);
      
      let decrypted = decipher.update(stored.api_key_encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const parsed = JSON.parse(decrypted);
      
      log('✅ Credentials decrypted successfully', 'green');
      log(`   API Key: ${parsed.apiKey.substring(0, 8)}...`, 'green');
      log(`   API Secret: ${parsed.apiSecret.substring(0, 8)}...`, 'green');
      
      return { success: true, credentials: parsed };
    } catch (decryptError) {
      log('❌ Decryption failed', 'red');
      log(`   Error: ${decryptError.message}`, 'red');
      log('\n🔧 FIX: Credentials were encrypted with different key', 'yellow');
      log('   User needs to re-enter API credentials', 'yellow');
      return { success: false, reason: 'decryption_failed' };
    }
  } catch (error) {
    log('❌ Credential decryption test failed', 'red');
    log(`   Error: ${error.message}`, 'red');
    return { success: false, error };
  }
}

async function testPoloniexApiConnection(credentials) {
  section('4. POLONIEX API CONNECTION TEST');
  
  if (!credentials) {
    log('⚠️  Skipping - no credentials available', 'yellow');
    return { success: false, reason: 'no_credentials' };
  }
  
  try {
    log('Testing Poloniex Futures API connection...', 'blue');
    
    const timestamp = Date.now().toString();
    const requestPath = '/v3/account/balance';
    const method = 'GET';
    
    // Generate signature
    const paramString = `signTimestamp=${timestamp}`;
    const message = `${method}\n${requestPath}\n${paramString}`;
    const signature = crypto
      .createHmac('sha256', credentials.apiSecret)
      .update(message)
      .digest('base64');
    
    log('   Making API request...', 'blue');
    
    const response = await axios({
      method: 'GET',
      url: `https://api.poloniex.com${requestPath}`,
      headers: {
        'Content-Type': 'application/json',
        'key': credentials.apiKey,
        'signature': signature,
        'signTimestamp': timestamp,
        'signatureMethod': 'hmacSHA256',
        'signatureVersion': '2'
      },
      timeout: 10000
    });
    
    log('✅ Poloniex API connection successful', 'green');
    log(`   Response status: ${response.status}`, 'green');
    
    if (response.data && response.data.data) {
      const balance = response.data.data;
      log(`   Balance data received:`, 'green');
      log(`   - Total Equity: ${balance.eq || '0'}`, 'green');
      log(`   - Available Margin: ${balance.availMgn || '0'}`, 'green');
      log(`   - Unrealized PnL: ${balance.upl || '0'}`, 'green');
      
      return { success: true, balance: balance };
    } else {
      log('⚠️  API response missing data field', 'yellow');
      log(`   Full response: ${JSON.stringify(response.data)}`, 'yellow');
      return { success: true, balance: null };
    }
  } catch (error) {
    log('❌ Poloniex API connection failed', 'red');
    log(`   Error: ${error.message}`, 'red');
    
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Response: ${JSON.stringify(error.response.data)}`, 'red');
      
      if (error.response.status === 401) {
        log('\n🔧 FIX: Authentication failed', 'yellow');
        log('   Possible causes:', 'yellow');
        log('   1. Invalid API key or secret', 'yellow');
        log('   2. API key not enabled for Futures trading', 'yellow');
        log('   3. IP address not whitelisted', 'yellow');
        log('\n   Solutions:', 'yellow');
        log('   - Verify API credentials in Poloniex account', 'yellow');
        log('   - Enable Futures trading permission', 'yellow');
        log('   - Add server IP to whitelist', 'yellow');
      }
    }
    
    return { success: false, error };
  }
}

async function testBackendEndpoint() {
  section('5. BACKEND ENDPOINT TEST');
  
  try {
    log('Testing backend /api/dashboard/balance endpoint...', 'blue');
    
    // This would require a valid JWT token
    log('⚠️  Skipping - requires authentication token', 'yellow');
    log('   To test manually:', 'yellow');
    log('   1. Login to get JWT token', 'yellow');
    log('   2. curl -H "Authorization: Bearer <token>" http://localhost:3000/api/dashboard/balance', 'yellow');
    
    return { success: true, skipped: true };
  } catch (error) {
    log('❌ Backend endpoint test failed', 'red');
    log(`   Error: ${error.message}`, 'red');
    return { success: false, error };
  }
}

async function provideFixes(results) {
  section('COMPREHENSIVE FIX RECOMMENDATIONS');
  
  const issues = [];
  
  if (!results.database.success) {
    issues.push({
      priority: 'CRITICAL',
      issue: 'Database Connection Failure',
      fix: 'Implement connection retry logic with exponential backoff'
    });
  }
  
  if (!results.credentials.success) {
    if (results.credentials.reason === 'no_credentials') {
      issues.push({
        priority: 'HIGH',
        issue: 'No API Credentials Stored',
        fix: 'User must add API credentials through Settings page'
      });
    } else if (results.credentials.reason === 'missing_encryption_tag') {
      issues.push({
        priority: 'HIGH',
        issue: 'Old Encryption Format',
        fix: 'User must re-enter API credentials (encryption format updated)'
      });
    }
  }
  
  if (!results.decryption.success) {
    issues.push({
      priority: 'HIGH',
      issue: 'Credential Decryption Failed',
      fix: 'User must re-enter API credentials'
    });
  }
  
  if (!results.poloniex.success) {
    issues.push({
      priority: 'HIGH',
      issue: 'Poloniex API Connection Failed',
      fix: 'Verify API credentials, enable Futures trading, whitelist IP'
    });
  }
  
  if (issues.length === 0) {
    log('✅ No issues found - balance display should work correctly', 'green');
    return;
  }
  
  log('\nIssues Found:', 'red');
  issues.forEach((issue, index) => {
    log(`\n${index + 1}. [${issue.priority}] ${issue.issue}`, 'yellow');
    log(`   Fix: ${issue.fix}`, 'cyan');
  });
  
  log('\n\nIMPLEMENTATION FIXES:', 'magenta');
  log('\n1. Database Connection Resilience:', 'cyan');
  log('   - Add retry logic to db/connection.js', 'white');
  log('   - Implement connection pool health checks', 'white');
  log('   - Add circuit breaker pattern', 'white');
  
  log('\n2. API Credentials Service:', 'cyan');
  log('   - Add better error handling in getCredentials()', 'white');
  log('   - Return null instead of throwing on missing tag', 'white');
  log('   - Add credential validation endpoint', 'white');
  
  log('\n3. Dashboard Balance Endpoint:', 'cyan');
  log('   - Add fallback to mock data on API failure', 'white');
  log('   - Implement caching for balance data', 'white');
  log('   - Add detailed error responses', 'white');
  
  log('\n4. Frontend Balance Widget:', 'cyan');
  log('   - Show specific error messages', 'white');
  log('   - Add "Setup API Keys" button when missing', 'white');
  log('   - Implement retry mechanism', 'white');
}

async function main() {
  log('Starting comprehensive balance display diagnostic...', 'cyan');
  log(`Test User ID: ${TEST_USER_ID}`, 'cyan');
  
  const results = {
    database: { success: false },
    credentials: { success: false },
    decryption: { success: false },
    poloniex: { success: false },
    backend: { success: false }
  };
  
  // Test 1: Database Connection
  results.database = await testDatabaseConnection();
  
  if (!results.database.success) {
    log('\n⚠️  Cannot proceed with further tests - database connection failed', 'yellow');
    await provideFixes(results);
    process.exit(1);
  }
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });
  
  try {
    // Test 2: API Credentials Retrieval
    results.credentials = await testApiCredentialsRetrieval(pool);
    
    // Test 3: Credential Decryption
    if (results.credentials.success) {
      results.decryption = await testCredentialDecryption(pool);
    }
    
    // Test 4: Poloniex API Connection
    if (results.decryption.success) {
      results.poloniex = await testPoloniexApiConnection(results.decryption.credentials);
    }
    
    // Test 5: Backend Endpoint
    results.backend = await testBackendEndpoint();
    
    // Provide comprehensive fixes
    await provideFixes(results);
    
  } finally {
    await pool.end();
  }
  
  log('\n\nDiagnostic complete!', 'cyan');
}

main().catch(error => {
  log(`\n❌ Diagnostic script failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
