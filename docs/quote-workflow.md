# Quote workflow: request → final quote → payment

How a trip a traveller plans becomes a paid booking, who does what at each
step, and what you need to switch on Razorpay.

```
 Traveller                              Agency (/admin)
 ─────────                              ───────────────
 Plans a trip, sees a live estimate
 "Send for final approval"
   email + phone (optional) + note ───►  pending      email: "New quote request" + link
                                         │            (traveller also gets a confirmation email)
                                         ▼
                                         in_review    "Start preparing" / saving a draft
                                         │            Quote editor: change the trip, price,
                                         │            discounts, optional extras, deposit
                                         ▼
 ◄── email: "Your final quote is ready"  quoted       "Send final quote" → numbered revision
 Reviews itinerary + price
 ticks optional extras
        ├─ Request changes ────────────► changes_requested ──► agency sends a revision (v2…)
        ├─ Decline ───────────────────► declined
        └─ Accept ────────────────────► accepted      agency is emailed
             │
             ▼ Razorpay Checkout
           part_paid ──► paid          both get a receipt; booking confirmed
```

Exits: `expired` (the quote's validity date passed; the agency can send a fresh
one), `cancelled` (traveller withdrew), `closed` (agency closed it). The rules
live in one place, `lib/quote-workflow.ts`, and the Worker refuses any move not
in its transition table.

## What the traveller sees

`/my-requests` lists every request with a status badge and an "action needed"
prompt. `/my-requests/view?id=…` shows a five-stage tracker (Request sent →
Being prepared → Final quote → Payment → Confirmed), one sentence on what is
happening and what is next, the quote with its itinerary, the payments and a
timeline. Everything they can do is on that page.

## What the agency does

`/admin` → **Trip requests** is the inbox (filter: needs us / waiting on
traveller / paid / closed; search by name, email, phone, destination). Opening a
request shows the traveller's contact details (email, call and WhatsApp
shortcuts), their note, and the **quote editor**:

1. **Trip details** — the planner's own form (party, dates, hotel class, meals,
   transport…). Opens exactly as the traveller left it.
2. **Destinations** — add or remove places on the map.
3. **Itinerary & optional items** — the planner's quotation view: switch flights,
   visa and insurance on or off, choose sightseeing, move nights, change a leg's
   transport mode. Every change re-prices live.
4. **Pricing & terms** — pin a fixed package price, add charges or discounts,
   offer **optional extras** (tick-boxes the traveller may add), take a deposit,
   set how long the quote stays open, and write a note to the traveller.
5. **Preview** — the quote page exactly as the traveller will see it.

*Save draft* stores work in progress (the traveller sees nothing). *Send final
quote* creates a numbered revision, moves the request to `quoted` and emails the
traveller. Earlier revisions are kept. Sending again after the traveller accepted
(before any payment) clears their acceptance — the confirm dialog says so.
Internal notes are never shown to the traveller.

## Money

* The browser never decides a price. At acceptance the Worker recomputes the
  total from the stored revision and the extras ticked (`priceQuote` in
  `lib/quote-pricing.ts`), and it computes every payment amount itself.
* A **deposit** (optional, set per quote) is charged first; the balance is a
  second Razorpay order after the first payment settles.
* Contingency and agency margin are never shown: the traveller receives a
  `PublicQuote` (category breakdown, itinerary, extras), not the engine payload.

## Switching on Razorpay

Until the three secrets are set, everything works except the pay button:
accepting still records the acceptance and emails the agency, and the page tells
the traveller that payment details will follow.

1. **Razorpay Dashboard → Settings → API Keys** → generate a key. Use *Test mode*
   keys first.
2. **Settings → Payment Capture** → set to **automatic** (the Worker settles on
   capture and does not capture manually).
3. **Settings → Webhooks → Add**
   * URL: `https://retroholidays.in/api/webhooks/razorpay`
   * Secret: any long random string (this becomes `RAZORPAY_WEBHOOK_SECRET`)
   * Events: `payment.captured`, `order.paid`, `payment.failed`
4. Set the secrets on the API Worker (from `workers/api`):

   ```bash
   npx wrangler secret put RAZORPAY_KEY_ID
   npx wrangler secret put RAZORPAY_KEY_SECRET
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
   ```

   (add `--env preview` for the preview Worker, with test keys).
5. Apply the migration: `npm run cf:d1:migrate`.

The webhook is what settles a payment if the traveller closes the tab after
paying; the browser callback and the webhook can both arrive, in any order,
and the request still settles exactly once.

### Going live

Switch the Dashboard to Live mode, generate live keys, re-create the webhook in
live mode (it has its own secret), and replace the three secrets. Razorpay needs
KYC completed for live payments. International cards, if you want them, are a
Dashboard setting and Razorpay may need to enable them for your account.

## Data

Migration `0006_quote_workflow.sql` adds contact and acceptance columns to
`quotation_request`, and the tables `quote_revision`, `request_event` and
`payment`. Statuses `approved` / `rejected` from before the workflow were
unreachable from the UI and are mapped to `closed`.

## Endpoints

Traveller (signed in, owner only — another account's id is a 404):

| Method | Path | |
| --- | --- | --- |
| POST | `/api/requests` | submit (contact, optional phone, note) |
| GET | `/api/requests`, `/api/requests/:id` | list / detail with timeline, quote, payments |
| POST | `/api/requests/:id/accept` | `{revisionId, optionIds, agreed}` |
| POST | `/api/requests/:id/changes` · `/decline` · `/cancel` | |
| POST | `/api/requests/:id/pay` | create/reuse a Razorpay order |
| POST | `/api/requests/:id/pay/verify` | verify Checkout's signature, settle |
| POST | `/api/webhooks/razorpay` | Razorpay → Worker, signature-verified |

Admin (404 to everyone else; see `admin.ts` for who counts as admin):

| Method | Path | |
| --- | --- | --- |
| GET | `/api/admin/requests`, `/api/admin/requests/:id` | inbox / full detail |
| POST | `/api/admin/requests/:id/review` · `/draft` · `/send` · `/note` · `/close` | |
