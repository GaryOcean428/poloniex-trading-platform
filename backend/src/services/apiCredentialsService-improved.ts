/**
 * Improved API Credentials Service
 * 
 * Enhanced version with:
 * - Better error handling
 * - Graceful degradation
 * - Detailed logging
 * - Validation
 */

import { pool } from '../db/connection.js';
import { encryptionService } from './encryptionService.js';
import { logger } from '../utils/logger.js';

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

export class ImprovedApiCredentialsService {
  /**
   * Store encrypted API credentials for a user
   */
  async storeCredentials(
    userId: string,
    apiKey: string,
    apiSecret: string,
    exchange: string = 'poloniex',
    credentialName?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate inputs
      if (!userId || !apiKey || !apiSecret) {
        logger.error('Invalid credentials input', { userId, hasApiKey: !!apiKey, hasApiSecret: !!apiSecret });
        return { success: false, error: 'User ID, API key, and API secret are required' };
      }

      // Validate API key format (basic check)
      if (apiKey.length < 10 || apiSecret.length < 10) {
        logger.error('API credentials too short', { apiKeyLength: apiKey.length, apiSecretLength: apiSecret.length });
        return { success: false, error: 'API key and secret must be at least 10 characters' };
      }

      logger.info('Storing API credentials', { userId, exchange, apiKeyPrefix: apiKey.substring(0, 8) });

      // Encrypt credentials
      const encrypted = encryptionService.encryptCredentials(apiKey, apiSecret);
      
      logger.debug('Credentials encrypted', {
        hasEncrypted: !!encrypted.apiKeyEncrypted,
        hasIv: !!encrypted.encryptionIv,
        hasTag: !!encrypted.tag
      });
      
      // Default credential name if not provided
      const name = credentialName || `${exchange.charAt(0).toUpperCase() + exchange.slice(1)} API`;
      
      // Store in database (upsert)
      const result = await pool.query(
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
          updated_at = CURRENT_TIMESTAMP
        RETURNING id`,
        [userId, exchange, encrypted.apiKeyEncrypted, encrypted.apiSecretEncrypted, encrypted.encryptionIv, encrypted.tag]
      );
      
      logger.info('API credentials stored successfully', {
        userId,
        exchange,
        credentialId: result.rows[0].id
      });

      return { success: true };
    } catch (error: any) {
      logger.error('Error storing API credentials', {
        error: error.message,
        code: error.code,
        userId,
        exchange
      });
      
      return {
        success: false,
        error: `Failed to store API credentials: ${error.message}`
      };
    }
  }

  /**
   * Retrieve and decrypt API credentials for a user
   * Returns null if credentials don't exist or can't be decrypted (graceful degradation)
   */
  async getCredentials(userId: string, exchange: string = 'poloniex'): Promise<ApiCredentials | null> {
    try {
      logger.debug('Retrieving API credentials', { userId, exchange });

      const result = await pool.query<StoredCredentials>(
        `SELECT id, user_id, exchange, api_key_encrypted, api_secret_encrypted, 
                encryption_iv, encryption_tag, is_active, last_used_at, created_at, updated_at
         FROM api_credentials
         WHERE user_id = $1 AND exchange = $2 AND is_active = true
         LIMIT 1`,
        [userId, exchange]
      );
      
      if (result.rows.length === 0) {
        logger.info('No active credentials found', { userId, exchange });
        return null;
      }
      
      const stored = result.rows[0];
      
      logger.debug('Credentials found in database', {
        userId,
        exchange,
        credentialId: stored.id,
        hasTag: !!stored.encryption_tag,
        hasIv: !!stored.encryption_iv
      });
      
      // Check if encryption_tag exists (for backward compatibility with old data)
      if (!stored.encryption_tag) {
        logger.warn('API credentials missing encryption tag - user needs to re-enter credentials', {
          userId,
          exchange,
          credentialId: stored.id
        });
        
        // Mark as inactive so user is prompted to re-enter
        await this.deactivateCredentials(userId, exchange);
        
        return null;
      }
      
      // Decrypt credentials
      try {
        const decrypted = encryptionService.decryptCredentials(
          stored.api_key_encrypted,
          stored.api_secret_encrypted,
          stored.encryption_iv,
          stored.encryption_tag
        );
        
        logger.debug('Credentials decrypted successfully', {
          userId,
          exchange,
          apiKeyPrefix: decrypted.apiKey.substring(0, 8)
        });
        
        // Update last used timestamp (non-blocking)
        this.updateLastUsed(stored.id).catch(err => {
          logger.error('Failed to update last_used_at', { error: err.message, credentialId: stored.id });
        });
        
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
      } catch (decryptError: any) {
        logger.error('Failed to decrypt credentials', {
          error: decryptError.message,
          userId,
          exchange,
          credentialId: stored.id
        });
        
        // Mark as inactive so user is prompted to re-enter
        await this.deactivateCredentials(userId, exchange);
        
        return null;
      }
    } catch (error: any) {
      logger.error('Error retrieving API credentials', {
        error: error.message,
        code: error.code,
        userId,
        exchange
      });
      
      // Return null instead of throwing - graceful degradation
      return null;
    }
  }

  /**
   * Validate credentials by testing them with Poloniex API
   */
  async validateCredentials(userId: string, exchange: string = 'poloniex'): Promise<{
    valid: boolean;
    error?: string;
    balance?: any;
  }> {
    try {
      const credentials = await this.getCredentials(userId, exchange);
      
      if (!credentials) {
        return { valid: false, error: 'No credentials found' };
      }

      // Import Poloniex service dynamically to avoid circular dependency
      const { default: poloniexFuturesService } = await import('./poloniexFuturesService.js');
      
      try {
        const balance = await poloniexFuturesService.getAccountBalance(credentials);
        
        logger.info('Credentials validated successfully', {
          userId,
          exchange,
          hasBalance: !!balance
        });
        
        return { valid: true, balance };
      } catch (apiError: any) {
        logger.error('Credentials validation failed - API error', {
          error: apiError.message,
          status: apiError.response?.status,
          userId,
          exchange
        });
        
        return {
          valid: false,
          error: `API validation failed: ${apiError.message}`
        };
      }
    } catch (error: any) {
      logger.error('Error validating credentials', {
        error: error.message,
        userId,
        exchange
      });
      
      return {
        valid: false,
        error: `Validation error: ${error.message}`
      };
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
      
      logger.info('API credentials deleted', { userId, exchange });
    } catch (error: any) {
      logger.error('Error deleting API credentials', {
        error: error.message,
        userId,
        exchange
      });
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
      
      logger.info('API credentials deactivated', { userId, exchange });
    } catch (error: any) {
      logger.error('Error deactivating API credentials', {
        error: error.message,
        userId,
        exchange
      });
      // Don't throw - this is a non-critical operation
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
    } catch (error: any) {
      logger.error('Error checking API credentials', {
        error: error.message,
        userId,
        exchange
      });
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
    } catch (error: any) {
      // Non-critical error, just log it
      logger.error('Error updating last_used_at', {
        error: error.message,
        credentialId
      });
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
    } catch (error: any) {
      logger.error('Error getting active users', {
        error: error.message,
        exchange
      });
      return [];
    }
  }

  /**
   * Get credentials status for user (without decrypting)
   */
  async getCredentialsStatus(userId: string, exchange: string = 'poloniex'): Promise<{
    exists: boolean;
    isActive: boolean;
    hasEncryptionTag: boolean;
    lastUsed: Date | null;
    createdAt: Date | null;
  }> {
    try {
      const result = await pool.query(
        `SELECT is_active, encryption_tag, last_used_at, created_at
         FROM api_credentials
         WHERE user_id = $1 AND exchange = $2
         LIMIT 1`,
        [userId, exchange]
      );
      
      if (result.rows.length === 0) {
        return {
          exists: false,
          isActive: false,
          hasEncryptionTag: false,
          lastUsed: null,
          createdAt: null
        };
      }
      
      const row = result.rows[0];
      return {
        exists: true,
        isActive: row.is_active,
        hasEncryptionTag: !!row.encryption_tag,
        lastUsed: row.last_used_at,
        createdAt: row.created_at
      };
    } catch (error: any) {
      logger.error('Error getting credentials status', {
        error: error.message,
        userId,
        exchange
      });
      
      return {
        exists: false,
        isActive: false,
        hasEncryptionTag: false,
        lastUsed: null,
        createdAt: null
      };
    }
  }
}

// Export singleton instance
export const improvedApiCredentialsService = new ImprovedApiCredentialsService();
