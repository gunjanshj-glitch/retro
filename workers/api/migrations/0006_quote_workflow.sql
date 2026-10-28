-- Quote workflow: request → review → final quote → acceptance → payment.
--
-- `quotation_request` already holds what the traveller sent. This migration
-- turns it into a tracked case:
--
--   * contact details the traveller gives when sending (phone is optional),
--   * `quote_revision` — every quote the agency drafts or sends, numbered, so
--     a revised quote never overwrites what the traveller was previously shown,
--   * `request_event` — a timeline the traveller can read (and the agency's
--     private notes, flagged internal),
--   * `payment` — one row per Razorpay order.
--
-- Statuses (see lib/quote-workflow.ts):
--   pending, in_review, quoted, changes_requested, accepted, part_paid, paid,
--   declined, expired, cancelled, closed
--
-- Apply with, from the repo root:
--   npm run cf:d1:migrate

ALTER TABLE quotation_request ADD COLUMN contact_email TEXT;
ALTER TABLE quotation_request ADD COLUMN contact_phone TEXT;
ALTER TABLE quotation_request ADD COLUMN traveller_note TEXT;
ALTER TABLE quotation_request ADD COLUMN updated_at TEXT;

-- The latest quote the agency has sent (denormalised for lists and dashboards).
ALTER TABLE quotation_request ADD COLUMN quoted_total_inr REAL;
ALTER TABLE quotation_request ADD COLUMN quote_valid_until TEXT;

-- What the traveller agreed to. `accepted_total_inr` is computed by the Worker
-- from the stored revision and the options ticked, never taken from the browser.
ALTER TABLE quotation_request ADD COLUMN accepted_revision_id TEXT;
ALTER TABLE quotation_request ADD COLUMN accepted_option_ids TEXT;
ALTER TABLE quotation_request ADD COLUMN accepted_total_inr REAL;
ALTER TABLE quotation_request ADD COLUMN accepted_at TEXT;

-- Rupees received so far, recomputed from `payment` rows whenever one settles.
ALTER TABLE quotation_request ADD COLUMN paid_inr REAL NOT NULL DEFAULT 0;

-- The two legacy statuses had no way to be reached from the UI and no quote
-- behind them, so they cannot continue through the new flow.
UPDATE quotation_request SET status = 'closed' WHERE status IN ('approved', 'rejected');

CREATE INDEX IF NOT EXISTS idx_qr_status ON quotation_request (status, created_at DESC);

-- One row per quote version. At most one 'draft' exists per request (the
-- agency's work in progress); 'sent' is what the traveller sees; a newer sent
-- revision turns the previous one 'superseded' but keeps it for the record.
CREATE TABLE IF NOT EXISTS quote_revision (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES quotation_request(id),
  version       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  sent_at       TEXT,
  created_by    TEXT,
  -- JSON: { request: QuoteRequest, quotation: Quotation, adjustments }.
  -- Admin-only: carries engine internals.
  payload       TEXT NOT NULL,
  -- JSON: PublicQuote — the only form the traveller ever receives.
  public_view   TEXT,
  -- JSON: QuoteAdjustments (pinned package price, extra lines, deposit). Kept
  -- apart from `payload` so accepting and charging never parse a whole itinerary.
  adjustments   TEXT NOT NULL DEFAULT '{}',
  -- What the engine priced the trip at, the package price after any pinned
  -- figure, and the total with every non-optional extra applied (optional
  -- extras are priced at acceptance).
  engine_total_inr REAL NOT NULL DEFAULT 0,
  package_inr   REAL NOT NULL DEFAULT 0,
  total_inr     REAL NOT NULL DEFAULT 0,
  deposit_inr   REAL,
  valid_until   TEXT,
  note          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rev_version ON quote_revision (request_id, version);
CREATE INDEX IF NOT EXISTS idx_rev_request ON quote_revision (request_id, status);

CREATE TABLE IF NOT EXISTS request_event (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES quotation_request(id),
  created_at  TEXT NOT NULL,
  -- 'traveller' | 'agency' | 'system'
  actor       TEXT NOT NULL,
  actor_name  TEXT,
  type        TEXT NOT NULL,
  -- 1 for the agency's private notes; never returned to travellers.
  internal    INTEGER NOT NULL DEFAULT 0,
  summary     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_request ON request_event (request_id, created_at);

CREATE TABLE IF NOT EXISTS payment (
  id                  TEXT PRIMARY KEY,
  request_id          TEXT NOT NULL REFERENCES quotation_request(id),
  revision_id         TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  -- Integer paise, which is what Razorpay takes and returns.
  amount_paise        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  -- 'created' (order opened, nothing paid), 'paid', 'failed'
  status              TEXT NOT NULL DEFAULT 'created',
  -- 'deposit' | 'balance' | 'full'
  kind                TEXT NOT NULL,
  razorpay_order_id   TEXT NOT NULL,
  razorpay_payment_id TEXT,
  method              TEXT,
  paid_at             TEXT,
  failure_reason      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_order ON payment (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_request ON payment (request_id, created_at);
