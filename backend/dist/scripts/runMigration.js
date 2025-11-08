import { pool } from '../db/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function runMigration(migrationFile) {
    try {
        console.log(`Running migration: ${migrationFile}`);
        const migrationPath = path.join(__dirname, '../../migrations', migrationFile);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        // Execute migration
        await pool.query(sql);
        console.log(`✅ Migration ${migrationFile} completed successfully`);
    }
    catch (error) {
        console.error(`❌ Migration ${migrationFile} failed:`, error);
        throw error;
    }
}
async function main() {
    const migrationFile = process.argv[2];
    if (!migrationFile) {
        console.error('Usage: npm run migrate <migration-file>');
        console.error('Example: npm run migrate 006_autonomous_agent_tables.sql');
        process.exit(1);
    }
    try {
        await runMigration(migrationFile);
        process.exit(0);
    }
    catch (error) {
        process.exit(1);
    }
}
main();
