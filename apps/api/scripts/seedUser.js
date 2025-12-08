#!/usr/bin/env node

import { UserService } from '../src/services/userService.js';

/**
 * Seed test user: Braden Lang (GaryOcean)
 */
async function seedTestUser() {
  console.log('🌱 Seeding test user...');
  
  const testUser = {
    username: 'GaryOcean',
    email: 'braden.lang77@gmail.com',
    password: 'I.Am.Dev.1',
    latitude: 40.7128,
    longitude: -74.0060,
    countryCode: 'US',
    timezone: 'America/New_York',
    role: 'trader'
  };

  try {
    // Check if user already exists
    const existingUser = await UserService.findUser(testUser.email);
    if (existingUser) {
      console.log('✅ Test user already exists:', existingUser.username);
      console.log('   Email:', existingUser.email);
      console.log('   Role:', existingUser.role);
      console.log('   Created:', existingUser.created_at);
      return existingUser;
    }

    // Create new user
    const newUser = await UserService.createUser(testUser);
    console.log('✅ Test user created successfully!');
    console.log('   Username:', newUser.username);
    console.log('   Email:', newUser.email);
    console.log('   Role:', newUser.role);
    console.log('   ID:', newUser.id);
    
    return newUser;
  } catch (error) {
    console.error('❌ Error seeding test user:', error.message);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestUser()
    .then(() => {
      console.log('🎉 Seed completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seed failed:', error);
      process.exit(1);
    });
}

export { seedTestUser };