-- Fixed-window request counters (src/rate-limit.ts).
--
-- The public endpoints (sign-in, register, forgot-password, quote saving,
-- enquiries, live rates) had no limits, so a script could brute-force a
-- password, fill the database, or burn the upstream rate APIs' quota. One row
-- per (key, window); the Worker's scheduled job deletes old windows.
CREATE TABLE IF NOT EXISTS rate_limit (
  k  TEXT NOT NULL,
  w  INTEGER NOT NULL,
  n  INTEGER NOT NULL DEFAULT 0,
  -- Unix seconds after which the row is useless; lets one purge query serve every window size.
  exp INTEGER NOT NULL,
  PRIMARY KEY (k, w)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_exp ON rate_limit (exp);
