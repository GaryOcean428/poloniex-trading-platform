import { UserService } from '../src/services/userService.js';
import dotenv from 'dotenv';

dotenv.config();

async function testUserServiceMethods() {
  console.log('🔄 Testing UserService methods individually...');

  try {
    // Test 1: findUser method
    console.log('\n1️⃣ Testing UserService.findUser()...');
    const user = await UserService.findUser('demo');
    if (user) {
      console.log('✅ findUser() works - found user:', user.username);
    } else {
      console.log('❌ findUser() failed - no user found');
      return;
    }

    // Test 2: verifyPassword method
    console.log('\n2️⃣ Testing UserService.verifyPassword()...');
    const passwordValid = await UserService.verifyPassword(user, 'password');
    if (passwordValid) {
      console.log('✅ verifyPassword() works');
    } else {
      console.log('❌ verifyPassword() failed');
      return;
    }

    // Test 3: checkJurisdictionCompliance method
    console.log('\n3️⃣ Testing UserService.checkJurisdictionCompliance()...');
    try {
      const compliance = await UserService.checkJurisdictionCompliance(user.id);
      console.log('✅ checkJurisdictionCompliance() works:', compliance);
    } catch (error) {
      console.log('❌ checkJurisdictionCompliance() failed:', error.message);
    }

    // Test 4: createSession method
    console.log('\n4️⃣ Testing UserService.createSession()...');
    try {
      const session = await UserService.createSession({
        userId: user.id,
        refreshTokenHash: 'test-hash',
        sessionToken: 'test-session-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent',
        latitude: 40.7128,
        longitude: -74.0060,
        deviceFingerprint: 'test-fingerprint',
        mfaVerified: false
      });
      console.log('✅ createSession() works:', session);
    } catch (error) {
      console.log('❌ createSession() failed:', error.message);
    }

    // Test 5: updateLastLogin method
    console.log('\n5️⃣ Testing UserService.updateLastLogin()...');
    try {
      await UserService.updateLastLogin(user.id, 40.7128, -74.0060);
      console.log('✅ updateLastLogin() works');
    } catch (error) {
      console.log('❌ updateLastLogin() failed:', error.message);
    }

    // Test 6: logSecurityEvent method
    console.log('\n6️⃣ Testing UserService.logSecurityEvent()...');
    try {
      await UserService.logSecurityEvent({
        userId: user.id,
        eventType: 'test_event',
        eventDescription: 'Test security event',
        severity: 'info',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent',
        latitude: 40.7128,
        longitude: -74.0060
      });
      console.log('✅ logSecurityEvent() works');
    } catch (error) {
      console.log('❌ logSecurityEvent() failed:', error.message);
    }

    console.log('\n🎉 UserService method testing completed!');

  } catch (error) {
    console.error('❌ UserService method test failed:', error);
  }
}

testUserServiceMethods();
