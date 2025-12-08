-- Migration: Add permissions column to api_credentials table
-- This stores the permissions associated with the API key

ALTER TABLE api_credentials 
ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"read": true, "trade": true, "withdraw": false}'::jsonb;

-- Create index for faster lookups on permissions
CREATE INDEX IF NOT EXISTS idx_api_credentials_permissions ON api_credentials USING gin(permissions);
