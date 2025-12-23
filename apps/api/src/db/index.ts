/**
 * Database Module Barrel Export
 * Centralized exports for all database-related modules
 * 
 * Note: Both connection.js and resilient-connection.js export 'pool' and 'query'.
 * We export them from resilient-connection.js (the more robust implementation)
 * and rename the basic connection exports to avoid conflicts.
 */

export { pool, query } from './resilient-connection.js';
export { pool as basicPool, query as basicQuery, geoQuery } from './connection.js';
export { default as resilientConnection } from './resilient-connection.js';
