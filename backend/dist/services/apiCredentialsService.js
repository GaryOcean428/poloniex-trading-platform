/**
 * API Credentials Service
 * Manages encrypted storage and retrieval of user API credentials
 */
import { pool } from '../db/connection.js';
import { encryptionService } from './encryptionService.js';
export class ApiCredentialsService {
    /**
     * Store encrypted API credentials for a user
     */
    async storeCredentials(userId, apiKey, apiSecret, exchange = 'poloniex') {
        try {
            // Encrypt credentials
            const encrypted = encryptionService.encryptCredentials(apiKey, apiSecret);
            // Store in database (upsert)
            await pool.query(`INSERT INTO api_credentials (
          user_id, exchange, api_key_encrypted, api_secret_encrypted, encryption_iv, is_active
        ) VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (user_id, exchange)
        DO UPDATE SET
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          api_secret_encrypted = EXCLUDED.api_secret_encrypted,
          encryption_iv = EXCLUDED.encryption_iv,
          is_active = true,
          updated_at = CURRENT_TIMESTAMP`, [userId, exchange, encrypted.apiKeyEncrypted, encrypted.apiSecretEncrypted, encrypted.encryptionIv]);
            console.log(`API credentials stored for user ${userId} on ${exchange}`);
        }
        catch (error) {
            console.error('Error storing API credentials:', error);
            throw new Error('Failed to store API credentials');
        }
    }
    /**
     * Retrieve and decrypt API credentials for a user
     */
    async getCredentials(userId, exchange = 'poloniex') {
        try {
            const result = await pool.query(`SELECT id, user_id, exchange, api_key_encrypted, api_secret_encrypted, 
                encryption_iv, is_active, last_used_at, created_at, updated_at
         FROM api_credentials
         WHERE user_id = $1 AND exchange = $2 AND is_active = true
         LIMIT 1`, [userId, exchange]);
            if (result.rows.length === 0) {
                return null;
            }
            const stored = result.rows[0];
            // Decrypt credentials
            const decrypted = encryptionService.decryptCredentials(stored.api_key_encrypted, stored.api_secret_encrypted, stored.encryption_iv, stored.api_key_encrypted // Using encrypted key as tag for simplicity
            );
            // Update last used timestamp
            await this.updateLastUsed(stored.id);
            return {
                id: stored.id,
                userId: stored.user_id,
                exchange: stored.exchange,
                apiKey: decrypted.apiKey,
                apiSecret: decrypted.apiSecret,
                isActive: stored.is_active,
                lastUsedAt: stored.last_used_at,
                createdAt: stored.created_at,
                updatedAt: stored.updated_at
            };
        }
        catch (error) {
            console.error('Error retrieving API credentials:', error);
            throw new Error('Failed to retrieve API credentials');
        }
    }
    /**
     * Delete API credentials for a user
     */
    async deleteCredentials(userId, exchange = 'poloniex') {
        try {
            await pool.query(`DELETE FROM api_credentials WHERE user_id = $1 AND exchange = $2`, [userId, exchange]);
            console.log(`API credentials deleted for user ${userId} on ${exchange}`);
        }
        catch (error) {
            console.error('Error deleting API credentials:', error);
            throw new Error('Failed to delete API credentials');
        }
    }
    /**
     * Deactivate API credentials (soft delete)
     */
    async deactivateCredentials(userId, exchange = 'poloniex') {
        try {
            await pool.query(`UPDATE api_credentials SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND exchange = $2`, [userId, exchange]);
            console.log(`API credentials deactivated for user ${userId} on ${exchange}`);
        }
        catch (error) {
            console.error('Error deactivating API credentials:', error);
            throw new Error('Failed to deactivate API credentials');
        }
    }
    /**
     * Check if user has active credentials
     */
    async hasCredentials(userId, exchange = 'poloniex') {
        try {
            const result = await pool.query(`SELECT COUNT(*) as count FROM api_credentials
         WHERE user_id = $1 AND exchange = $2 AND is_active = true`, [userId, exchange]);
            return parseInt(result.rows[0].count) > 0;
        }
        catch (error) {
            console.error('Error checking API credentials:', error);
            return false;
        }
    }
    /**
     * Update last used timestamp
     */
    async updateLastUsed(credentialId) {
        try {
            await pool.query(`UPDATE api_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1`, [credentialId]);
        }
        catch (error) {
            // Non-critical error, just log it
            console.error('Error updating last_used_at:', error);
        }
    }
    /**
     * Get all users with active credentials (for background trading engine)
     */
    async getAllActiveUsers(exchange = 'poloniex') {
        try {
            const result = await pool.query(`SELECT DISTINCT user_id FROM api_credentials
         WHERE exchange = $1 AND is_active = true`, [exchange]);
            return result.rows.map(row => row.user_id);
        }
        catch (error) {
            console.error('Error getting active users:', error);
            return [];
        }
    }
}
// Export singleton instance
export const apiCredentialsService = new ApiCredentialsService();
