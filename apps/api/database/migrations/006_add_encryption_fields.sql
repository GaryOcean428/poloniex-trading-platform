-- Migration 006: Add encryption fields to user_api_credentials
-- Adds encryption_iv and encryption_tag columns for AES-256-GCM encryption

-- Add encryption fields
ALTER TABLE user_api_credentials 
ADD COLUMN IF NOT EXISTS encryption_iv TEXT,
ADD COLUMN IF NOT EXISTS encryption_tag TEXT;

-- Update existing records to have empty strings (they'll need to be re-encrypted)
UPDATE user_api_credentials 
SET encryption_iv = '', encryption_tag = ''
WHERE encryption_iv IS NULL OR encryption_tag IS NULL;

-- Make fields NOT NULL after populating
ALTER TABLE user_api_credentials 
ALTER COLUMN encryption_iv SET NOT NULL,
ALTER COLUMN encryption_tag SET NOT NULL;

-- Add comment
COMMENT ON COLUMN user_api_credentials.encryption_iv IS 'Initialization vector for AES-256-GCM encryption';
COMMENT ON COLUMN user_api_credentials.encryption_tag IS 'Authentication tag for AES-256-GCM encryption';
