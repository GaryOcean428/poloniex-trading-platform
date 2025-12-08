// Database client configuration for Drizzle ORM with Neon/Postgres
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Get database URL from environment
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create postgres client
export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance
export const db = drizzle(sql);
