-- Auth + quotation-request approval workflow.
--
-- A traveller can use the whole site, including the quotation engine,
-- without an account. An account only becomes necessary at the very last
-- step — asking the agency to turn a quotation into a final, human-checked
-- offer — because that is the point a conversation with a real person
-- starts, and the point we need somewhere to send the answer back to.
--
-- Apply with, from `workers/api`:
--   npx wrangler d1 migrations apply atlas --remote

-- A traveller's account. `password_hash`/`password_salt` are null for an
-- account created entirely through Google or Facebook; `auth_provider` +
-- `provider_id` are null for one created with an email and password.
-- Either path can be present without the other, but never neither.
CREATE TABLE IF NOT EXISTS user (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT,
  password_salt  TEXT,
  -- 'google' | 'facebook', null for an email/password account.
  auth_provider  TEXT,
  -- The provider's stable subject id for that user. Null for password accounts.
  provider_id    TEXT,
  avatar_url     TEXT
);

-- Case-sensitivity is not a concern here (emails are lower-cased before
-- every lookup and write — see auth.ts), so a plain unique index is enough.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON user (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_provider
  ON user (auth_provider, provider_id)
  WHERE auth_provider IS NOT NULL;

-- A signed-in session. The id itself is the bearer token set as an httpOnly
-- cookie — there is nothing else to look up it by, and nothing it needs to
-- carry beyond who it belongs to and when it stops being valid.
CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id);

-- Short-lived CSRF nonce for the OAuth redirect round trip. A row is deleted
-- the moment its callback is handled, successfully or not, so this table only
-- ever holds in-flight logins.
CREATE TABLE IF NOT EXISTS oauth_state (
  state        TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  redirect_to  TEXT
);

-- A quotation a traveller has asked the agency to review and confirm.
--
-- `snapshot` is the whole thing the traveller saw and agreed to — the
-- request that produced it, the full priced itinerary, and who they are —
-- captured once and never touched again. It is deliberately not just a
-- foreign key back to a live, replayable quote: a quote replays against
-- whatever the engine and rate card look like *today*, which is exactly
-- wrong for a record of what was promised at the moment someone clicked
-- "send for final approval". `total_inr`/`per_person_inr`/etc. are
-- denormalised from that same snapshot purely so the dashboard list can be
-- rendered without parsing it.
CREATE TABLE IF NOT EXISTS quotation_request (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  user_id             TEXT NOT NULL REFERENCES user(id),
  user_name           TEXT NOT NULL,
  user_email          TEXT NOT NULL,
  -- 'pending' until someone at the agency confirms or rejects it by email.
  status              TEXT NOT NULL DEFAULT 'pending',
  destination_summary TEXT NOT NULL,
  nights              INTEGER NOT NULL,
  start_date          TEXT NOT NULL,
  total_inr           REAL NOT NULL,
  per_person_inr      REAL NOT NULL,
  -- JSON: { submittedAt, user: {id,name,email}, request, quotation }.
  snapshot            TEXT NOT NULL,
  -- Whether the review email to the agency inbox went out. Best-effort: a
  -- failure here must never lose the request itself, so this is a flag to
  -- retry/triage from, not a condition on the insert succeeding.
  email_sent          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_qr_user ON quotation_request (user_id, created_at DESC);
