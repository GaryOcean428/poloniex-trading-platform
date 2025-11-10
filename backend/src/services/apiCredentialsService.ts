/**
 * API Credentials Service
 * Manages encrypted storage and retrieval of user API credentials
 */

import { pool } from '../db/connection.js';
import { encryptionService } from './encryptionService.js';

export interface ApiCredentials {
  id: string;
  userId: string;
  exchange: string;
  apiKey: string; // Decrypted
  apiSecret: string; // Decrypted
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredCredentials {
  id: string;
  user_id: string;
  exchange: string;
  api_key_encrypted: string;
  api_secret_encrypted: string;
  encryption_iv: string;
  encryption_tag: string;
  is_active: boolean;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class ApiCredentialsService {
  /**
   * Store encrypted API credentials for a user
   */
  async storeCredentials(
    userId: string,
    apiKey: string,
    apiSecret: string,
    exchange: string = 'poloniex'
  ): Promise<void> {
    try {
      // Encrypt credentials
      const encrypted = encryptionService.encryptCredentials(apiKey, apiSecret);
      
      // Store in database (upsert)
      await pool.query(
        `INSERT INTO api_credentials (
          user_id, exchange, api_key_encrypted, api_secret_encrypted, encryption_iv, encryption_tag, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (user_id, exchange)
        DO UPDATE SET
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          api_secret_encrypted = EXCLUDED.api_secret_encrypted,
          encryption_iv = EXCLUDED.encryption_iv,
          encryption_tag = EXCLUDED.encryption_tag,
          is_active = true,
          updated_at = CURRENT_TIMESTAMP`,
        [userId, exchange, encrypted.apiKeyEncrypted, encrypted.apiSecretEncrypted, encrypted.encryptionIv, encrypted.tag]
      );
      
      console.log(`API credentials stored for user ${userId} on ${exchange}`);
    } catch (error) {
      console.error('Error storing API credentials:', error);
      throw new Error('Failed to store API credentials');
    }
  }

  /**
   * Retrieve and decrypt API credentials for a user
   */
  async getCredentials(userId: string, exchange: string = 'poloniex'): Promise<ApiCredentials | null> {
    try {
      const result = await pool.query<StoredCredentials>(
        `SELECT id, user_id, exchange, api_key_encrypted, api_secret_encrypted, 
                encryption_iv, encryption_tag, is_active, last_used_at, created_at, updated_at
         FROM api_credentials
         WHERE user_id = $1 AND exchange = $2 AND is_active = true
         LIMIT 1`,
        [userId, exchange]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const stored = result.rows[0];
      
      // Check if encryption_tag exists (for backward compatibility with old data)
      if (!stored.encryption_tag) {
        console.warn(`API credentials for user ${userId} missing encryption tag - user needs to re-enter credentials`);
        return null;
      }
      
      // Decrypt credentials
      const decrypted = encryptionService.decryptCredentials(
        stored.api_key_encrypted,
        stored.api_secret_encrypted,
        stored.encryption_iv,
        stored.encryption_tag
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
    } catch (error) {
      console.error('Error retrieving API credentials:', error);
      throw new Error('Failed to retrieve API credentials');
    }
  }

  /**
   * Delete API credentials for a user
   */
  async deleteCredentials(userId: string, exchange: string = 'poloniex'): Promise<void> {
    try {
      await pool.query(
        `DELETE FROM api_credentials WHERE user_id = $1 AND exchange = $2`,
        [userId, exchange]
      );
      
      console.log(`API credentials deleted for user ${userId} on ${exchange}`);
    } catch (error) {
      console.error('Error deleting API credentials:', error);
      throw new Error('Failed to delete API credentials');
    }
  }

  /**
   * Deactivate API credentials (soft delete)
   */
  async deactivateCredentials(userId: string, exchange: string = 'poloniex'): Promise<void> {
    try {
      await pool.query(
        `UPDATE api_credentials SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND exchange = $2`,
        [userId, exchange]
      );
      
      console.log(`API credentials deactivated for user ${userId} on ${exchange}`);
    } catch (error) {
      console.error('Error deactivating API credentials:', error);
      throw new Error('Failed to deactivate API credentials');
    }
  }

  /**
   * Check if user has active credentials
   */
  async hasCredentials(userId: string, exchange: string = 'poloniex'): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM api_credentials
         WHERE user_id = $1 AND exchange = $2 AND is_active = true`,
        [userId, exchange]
      );
      
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      console.error('Error checking API credentials:', error);
      return false;
    }
  }

  /**
   * Update last used timestamp
   */
  private async updateLastUsed(credentialId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE api_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [credentialId]
      );
    } catch (error) {
      // Non-critical error, just log it
      console.error('Error updating last_used_at:', error);
    }
  }

  /**
   * Get all users with active credentials (for background trading engine)
   */
  async getAllActiveUsers(exchange: string = 'poloniex'): Promise<string[]> {
    try {
      const result = await pool.query(
        `SELECT DISTINCT user_id FROM api_credentials
         WHERE exchange = $1 AND is_active = true`,
        [exchange]
      );
      
      return result.rows.map(row => row.user_id);
    } catch (error) {
      console.error('Error getting active users:', error);
      return [];
    }
  }
}

// Export singleton instance
export const apiCredentialsService = new ApiCredentialsService();
