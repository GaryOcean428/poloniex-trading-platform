/**
 * Encryption Service
 * Handles secure encryption/decryption of sensitive data like API credentials
 * Uses AES-256-GCM for encryption
 */
import crypto from 'crypto';
import { env } from '../config/env.js';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is always 16
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;
export class EncryptionService {
    constructor() {
        // Use encryption key from environment, fallback to JWT_SECRET in production
        const encryptionKey = env.API_ENCRYPTION_KEY || env.JWT_SECRET;
        if (!encryptionKey) {
            throw new Error('API_ENCRYPTION_KEY or JWT_SECRET must be set in environment variables');
        }
        if (!env.API_ENCRYPTION_KEY && env.NODE_ENV === 'production') {
            console.warn('API_ENCRYPTION_KEY not set - using JWT_SECRET for API key encryption (not recommended for production)');
        }
        // Derive a consistent key from the master secret
        this.masterKey = crypto.scryptSync(encryptionKey, 'salt', KEY_LENGTH);
    }
    /**
     * Encrypt sensitive data
     * Returns: { encrypted: string, iv: string, tag: string }
     */
    encrypt(plaintext) {
        try {
            // Generate random IV
            const iv = crypto.randomBytes(IV_LENGTH);
            // Create cipher
            const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
            // Encrypt data
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            // Get authentication tag
            const tag = cipher.getAuthTag();
            return {
                encrypted,
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            };
        }
        catch (error) {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt data');
        }
    }
    /**
     * Decrypt sensitive data
     */
    decrypt(encrypted, iv, tag) {
        try {
            // Convert hex strings back to buffers
            const ivBuffer = Buffer.from(iv, 'hex');
            const tagBuffer = Buffer.from(tag, 'hex');
            // Create decipher
            const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, ivBuffer);
            decipher.setAuthTag(tagBuffer);
            // Decrypt data
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        catch (error) {
            console.error('Decryption error:', error);
            throw new Error('Failed to decrypt data');
        }
    }
    /**
     * Encrypt API credentials
     * Returns object ready for database storage
     */
    encryptCredentials(apiKey, apiSecret) {
        // Combine both credentials into a single JSON string to encrypt together
        // This ensures we only have one tag for both values
        const combined = JSON.stringify({ apiKey, apiSecret });
        const result = this.encrypt(combined);
        // Store the encrypted combined value in both fields for backward compatibility
        // The apiKeyEncrypted will contain the full encrypted JSON
        // The apiSecretEncrypted will be empty but we keep the field for schema compatibility
        return {
            apiKeyEncrypted: result.encrypted,
            apiSecretEncrypted: '', // Empty - not used in new approach
            encryptionIv: result.iv,
            tag: result.tag
        };
    }
    /**
     * Decrypt API credentials
     */
    decryptCredentials(apiKeyEncrypted, apiSecretEncrypted, encryptionIv, tag) {
        // Check if this is new format (combined encryption) or old format (separate)
        if (apiSecretEncrypted === '' || !apiSecretEncrypted) {
            // New format: decrypt the combined JSON
            const decrypted = this.decrypt(apiKeyEncrypted, encryptionIv, tag);
            const parsed = JSON.parse(decrypted);
            return {
                apiKey: parsed.apiKey,
                apiSecret: parsed.apiSecret
            };
        }
        else {
            // Old format: decrypt separately (this will fail with mismatched tags)
            // This is kept for backward compatibility but will likely throw an error
            return {
                apiKey: this.decrypt(apiKeyEncrypted, encryptionIv, tag),
                apiSecret: this.decrypt(apiSecretEncrypted, encryptionIv, tag)
            };
        }
    }
    /**
     * Helper: Encrypt with specific IV
     */
    encryptWithIv(plaintext, ivHex) {
        const iv = Buffer.from(ivHex, 'hex');
        const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return {
            encrypted,
            tag: tag.toString('hex')
        };
    }
    /**
     * Generate a secure random token
     */
    generateToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }
    /**
     * Hash a password or sensitive string (one-way)
     */
    hash(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
}
// Export singleton instance
export const encryptionService = new EncryptionService();
