-- Migration: Add encryption_tag column to api_credentials table
-- The GCM authentication tag is required for proper decryption of credentials

-- Add encryption_tag column if it doesn't exist
ALTER TABLE api_credentials 
ADD COLUMN IF NOT EXISTS encryption_tag TEXT;

-- For existing rows without a tag, we'll need to re-encrypt them
-- Users will need to re-enter their API keys after this migration
-- Mark existing credentials as inactive to force re-entry
UPDATE api_credentials 
SET is_active = false, 
    updated_at = CURRENT_TIMESTAMP
WHERE encryption_tag IS NULL;
