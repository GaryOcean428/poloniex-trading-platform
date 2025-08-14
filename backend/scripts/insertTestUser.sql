INSERT INTO users (username, email, password_hash, role, country_code, timezone)
VALUES
  ('GaryOcean', 'braden.lang77@gmail.com', '$2b$12$kpGETKNQmTytY6LOl7gg0eRSxuIH0G/akMV4sA/pKl5Vr9YowYhFq', 'trader', 'US', 'UTC')
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  username = EXCLUDED.username,
  role = EXCLUDED.role,
  country_code = EXCLUDED.country_code,
  timezone = EXCLUDED.timezone;
