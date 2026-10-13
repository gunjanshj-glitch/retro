-- Forgot-password / set-password-by-email.
--
-- A reset link proves control of the inbox, which is the only thing that can
-- vouch for an email address on this site (sign-up never verifies it). Only a
-- SHA-256 of the token is stored, so a database read never yields a usable link.
CREATE TABLE IF NOT EXISTS password_reset (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_reset_email ON password_reset (email, created_at);

-- Set when the password was chosen through an emailed link, i.e. the owner of
-- the address set it. The admin gate relies on this (see admin.ts).
ALTER TABLE user ADD COLUMN password_verified_at TEXT;
