-- "Request a quote" on a package page.
--
-- A signed-in traveller picks a package, tells us who is travelling and what
-- they want, and we record it here for someone at the agency to price by
-- hand. This is deliberately separate from `quotation_request`, which stores
-- a full planner snapshot with an engine-computed total; a package request
-- has no computed price until a person provides one.
--
-- `quoted_*` stay null until an admin replies. They are what the traveller's
-- dashboard shows as "the quote you received". There is no admin UI yet, so
-- for now they are set directly in D1:
--   UPDATE package_request
--      SET status='quoted', quoted_amount_inr=125000,
--          quote_note='Includes flights from Delhi', quoted_at=datetime('now')
--    WHERE id='...';
--
-- Apply with, from the repo root:
--   npm run cf:d1:migrate
CREATE TABLE IF NOT EXISTS package_request (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES user(id),
  user_name        TEXT NOT NULL,
  user_email       TEXT NOT NULL,
  -- 'pending' until quoted; 'quoted' once a price has been sent back;
  -- 'closed' for anything withdrawn or declined.
  status           TEXT NOT NULL DEFAULT 'pending',

  -- Which package this was raised against. Names are copied in so the record
  -- still reads correctly if the catalogue is later renamed or reshuffled.
  destination_slug TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  package_slug     TEXT NOT NULL,
  package_name     TEXT NOT NULL,

  -- What the traveller asked for.
  trip_type        TEXT NOT NULL,
  adults           INTEGER NOT NULL,
  children         INTEGER NOT NULL DEFAULT 0,
  start_date       TEXT,
  departure_city   TEXT NOT NULL,
  hotel_star       TEXT NOT NULL,
  include_flights  INTEGER NOT NULL DEFAULT 0,
  food             TEXT NOT NULL,
  notes            TEXT,
  -- JSON copy of the package as displayed (places, days, indicative price).
  package_snapshot TEXT NOT NULL,

  -- The agency's reply. All null until quoted.
  quoted_amount_inr REAL,
  quote_note        TEXT,
  quoted_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pkgreq_user ON package_request (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pkgreq_status ON package_request (status, created_at DESC);
