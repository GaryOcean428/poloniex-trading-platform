import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
pool.on('connect', () => {
    logger.info('Connected to PostgreSQL database');
});
pool.on('error', (err) => {
    logger.error('Database connection error', { error: err.message, stack: err.stack });
});
export const query = (text, params) => pool.query(text, params);
export const geoQuery = (text, params) => pool.query(text, params);
export { pool };
