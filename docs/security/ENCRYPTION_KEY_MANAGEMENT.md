# Encryption Key Management

## Overview

The Poloniex Trading Platform uses AES-256-GCM encryption to securely store user API credentials in the database. Proper encryption key management is **critical** for security and data integrity.

## How It Works

### Encryption Service
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: scrypt with 100,000 iterations
- **Location**: `backend/src/services/encryptionService.ts`

### Key Hierarchy
1. **Master Key**: `API_ENCRYPTION_KEY` environment variable (or `JWT_SECRET` as fallback)
2. **Derived Key**: Generated from master key using scrypt
3. **Per-Record IV**: Random 16-byte initialization vector for each encryption operation
4. **Authentication Tag**: 16-byte GCM tag for data integrity verification

### Storage Format (New Format)
```typescript
{
  api_key_encrypted: string,    // Contains encrypted JSON: { apiKey, apiSecret }
  api_secret_encrypted: string, // Empty string (deprecated field)
  encryption_iv: string,         // Hex-encoded IV
  encryption_tag: string         // Hex-encoded authentication tag
}
```

## Critical Requirements

### ⚠️ NEVER Change the Encryption Key

Once credentials are encrypted with a specific `API_ENCRYPTION_KEY`, that key **MUST** remain constant. Changing the key will make all existing encrypted credentials unreadable.

**Symptoms of key mismatch:**
- `Error: Unsupported state or unable to authenticate data`
- `Error: Failed to decrypt data`
- Users unable to see their balances
- API calls failing with authentication errors

### Environment Variables

#### Required (Production)
```bash
# Generate with: openssl rand -base64 32
API_ENCRYPTION_KEY=<32+ character random string>
JWT_SECRET=<32+ character random string>
```

#### Development
```bash
# Use consistent values across all environments
API_ENCRYPTION_KEY=your-encryption-key-here-change-in-production
JWT_SECRET=your-secret-key-here-change-in-production
```

## Deployment Checklist

### Initial Deployment
1. ✅ Generate strong encryption keys:
   ```bash
   openssl rand -base64 32  # For API_ENCRYPTION_KEY
   openssl rand -base64 32  # For JWT_SECRET
   ```

2. ✅ Set environment variables in deployment platform (Railway, etc.)

3. ✅ **Document and securely store** the encryption key (password manager, secrets vault)

4. ✅ Verify keys are loaded:
   ```bash
   curl https://your-api.com/api/health
   # Check logs for: HAS_API_ENCRYPTION_KEY: true
   ```

### Key Rotation (Advanced)

If you **must** rotate the encryption key:

1. **Backup database** before proceeding
2. Create migration script to:
   - Decrypt all credentials with old key
   - Re-encrypt with new key
   - Update all records atomically
3. Test migration on staging environment
4. Execute migration during maintenance window
5. Update `API_ENCRYPTION_KEY` environment variable
6. Restart all backend instances
7. Verify all users can access their credentials

**Migration Script Template:**
```typescript
// scripts/rotate-encryption-key.ts
import { encryptionService } from '../src/services/encryptionService';
import { pool } from '../src/config/database';

async function rotateEncryptionKey(oldKey: string, newKey: string) {
  const oldService = new EncryptionService(oldKey);
  const newService = new EncryptionService(newKey);
  
  const credentials = await pool.query('SELECT * FROM api_credentials');
  
  for (const row of credentials.rows) {
    // Decrypt with old key
    const decrypted = oldService.decryptCredentials(
      row.api_key_encrypted,
      row.api_secret_encrypted,
      row.encryption_iv,
      row.encryption_tag
    );
    
    // Re-encrypt with new key
    const encrypted = newService.encryptCredentials(
      decrypted.apiKey,
      decrypted.apiSecret
    );
    
    // Update database
    await pool.query(
      'UPDATE api_credentials SET api_key_encrypted = $1, encryption_iv = $2, encryption_tag = $3 WHERE id = $4',
      [encrypted.apiKeyEncrypted, encrypted.encryptionIv, encrypted.tag, row.id]
    );
  }
}
```

## Troubleshooting

### Users Can't Decrypt Credentials

**Cause**: Encryption key mismatch

**Solution**:
1. Check if `API_ENCRYPTION_KEY` environment variable is set correctly
2. Verify the key hasn't changed since credentials were encrypted
3. Check backend logs for encryption errors
4. If key is lost/changed, users must re-enter their API credentials

### Database Shows NULL api_secret_encrypted

**Status**: ✅ **This is normal** for new format

The new encryption format stores both API key and secret in the `api_key_encrypted` field as a single encrypted JSON object. The `api_secret_encrypted` field is intentionally left empty.

**Verify it's working:**
```sql
SELECT 
  LENGTH(api_key_encrypted) > 0 as has_combined_credentials,
  api_secret_encrypted = '' as using_new_format,
  encryption_iv IS NOT NULL as has_iv,
  encryption_tag IS NOT NULL as has_tag
FROM api_credentials;
```

Expected result:
- `has_combined_credentials`: true
- `using_new_format`: true
- `has_iv`: true
- `has_tag`: true

## Security Best Practices

1. **Never commit encryption keys** to version control
2. **Use different keys** for development, staging, and production
3. **Store keys securely** in a password manager or secrets vault
4. **Rotate keys periodically** (annually recommended)
5. **Monitor for decryption failures** in production logs
6. **Implement key backup strategy** before any key changes
7. **Use environment-specific .env files** (never share between environments)

## Files Modified

### Backend Configuration
- `backend/.env` - Created with consistent encryption keys
- `backend/src/routes/apiKeys.ts` - Fixed IPv6 rate limiter issue
- `backend/src/index.ts` - Added `/health` endpoint for monitoring

### Documentation
- `ENCRYPTION_KEY_MANAGEMENT.md` - This file

## Current Status

✅ Backend `.env` file created with consistent keys
✅ Rate limiter IPv6 issue fixed
✅ Health endpoint added
⚠️ **Users must re-enter API credentials** if they were encrypted with a different key

## Next Steps

1. Deploy backend with new `.env` configuration
2. Notify users to re-enter their Poloniex API credentials in Settings
3. Monitor logs for any decryption errors
4. Consider implementing key rotation strategy for future
