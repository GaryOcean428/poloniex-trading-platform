import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = 'https://polytrade-be.up.railway.app';

async function testLogin() {
  console.log('🔄 Testing login functionality...');

  const credentials = [
    { username: 'demo', password: 'password' },
    { username: 'trader', password: 'password' },
    { username: 'admin', password: 'password' }
  ];

  for (const cred of credentials) {
    console.log(`\n🔐 Testing login for ${cred.username}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cred)
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`✅ Login successful for ${cred.username}`);
        console.log(`  - User ID: ${data.user.id}`);
        console.log(`  - Role: ${data.user.role}`);
        console.log(`  - Token: ${data.accessToken ? 'Generated' : 'Missing'}`);

        // Test token verification
        if (data.accessToken) {
          console.log(`🔍 Testing token verification for ${cred.username}...`);
          const verifyResponse = await fetch(`${API_BASE_URL}/api/auth/verify`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${data.accessToken}`
            }
          });

          const verifyData = await verifyResponse.json();
          if (verifyResponse.ok) {
            console.log(`✅ Token verification successful for ${cred.username}`);
          } else {
            console.log(`❌ Token verification failed for ${cred.username}:`, verifyData.error);
          }
        }

      } else {
        console.log(`❌ Login failed for ${cred.username}:`, data.error);
      }

    } catch (error) {
      console.error(`❌ Network error testing ${cred.username}:`, error.message);
    }
  }

  console.log('\n🎉 Login testing completed!');
}

testLogin();
