-- Mobile app support (docs/mobile/01: B2 social return, B3 account deletion, B6 push).

-- B2: a sign-in begun by the app records who began it, and the PKCE challenge the app will have to prove.
ALTER TABLE oauth_state ADD COLUMN client TEXT;
ALTER TABLE oauth_state ADD COLUMN app_challenge TEXT;

-- B2: the one-time code the callback hands the app instead of a session. Only a hash is stored. Single use,
-- 60 seconds, and bound to the challenge so another app registered on the same URL scheme cannot redeem it.
CREATE TABLE IF NOT EXISTS auth_code (
  code_hash   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id),
  challenge   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- B6: a phone that can be pushed to. One row per Expo push token.
CREATE TABLE IF NOT EXISTS device (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user(id),
  platform         TEXT NOT NULL,
  expo_push_token  TEXT NOT NULL UNIQUE,
  app_version      TEXT,
  created_at       TEXT NOT NULL,
  last_seen        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_user ON device (user_id);

-- B6: Expo returns a ticket per push; its receipt (checked later by the cron job) says whether the token is dead.
CREATE TABLE IF NOT EXISTS push_ticket (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- B9/B6: one "your quote expires tomorrow" reminder per sent quote.
ALTER TABLE quotation_request ADD COLUMN reminder_sent_at TEXT;
