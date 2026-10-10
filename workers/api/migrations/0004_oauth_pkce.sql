-- PKCE verifier for the "Continue with X" redirect round trip (X's OAuth 2.0
-- requires PKCE). Null for Google/Facebook, which don't use it.
ALTER TABLE oauth_state ADD COLUMN code_verifier TEXT;
