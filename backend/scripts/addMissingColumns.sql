-- Add missing columns if they don't exist
ALTER TABLE geo_restrictions
ADD COLUMN IF NOT EXISTS enhanced_kyc_required BOOLEAN DEFAULT false;

-- Ensure all necessary columns exist in users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Update geo_restrictions with missing data
UPDATE geo_restrictions SET country_name = 'United States' WHERE country_code = 'US' AND country_name IS NULL;
UPDATE geo_restrictions SET country_name = 'China' WHERE country_code = 'CN' AND country_name IS NULL;
UPDATE geo_restrictions SET country_name = 'Japan' WHERE country_code = 'JP' AND country_name IS NULL;
UPDATE geo_restrictions SET country_name = 'United Kingdom' WHERE country_code = 'GB' AND country_name IS NULL;
UPDATE geo_restrictions SET country_name = 'Canada' WHERE country_code = 'CA' AND country_name IS NULL;
UPDATE geo_restrictions SET country_name = 'Australia' WHERE country_code = 'AU' AND country_name IS NULL;

-- Add some default geo restrictions if they don't exist
INSERT INTO geo_restrictions (country_code, country_name, trading_allowed, futures_allowed, kyc_required)
VALUES
  ('US', 'United States', true, true, true),
  ('CN', 'China', false, false, true),
  ('JP', 'Japan', true, true, true),
  ('GB', 'United Kingdom', true, true, true),
  ('CA', 'Canada', true, true, true),
  ('AU', 'Australia', true, true, true)
ON CONFLICT (country_code) DO UPDATE SET
  country_name = EXCLUDED.country_name,
  trading_allowed = EXCLUDED.trading_allowed,
  futures_allowed = EXCLUDED.futures_allowed,
  kyc_required = EXCLUDED.kyc_required;
