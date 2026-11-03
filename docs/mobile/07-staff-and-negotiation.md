# 07. Staff mode and the quote negotiation

Added after review. You answered that staff should use **all features in the app** and that **the quote review back-and-forth until payment is important**. That reverses the earlier "admin stays on the web" decision (ADR-7, now superseded by ADR-8 in doc 06).

Confidence tags: **[Certain]** read in the repo or reproduced by a test I ran, **[Likely]** inference, **[Guessing]** assumption.

## Good news first: the backend already runs the whole negotiation [Certain]

`packages/core/quote-workflow.ts`, `workers/api/src/request-admin.ts`, `requests.ts`, `payments.ts` implement a complete loop. The app is a new **client** for it, not a new backend:

- 11 statuses with an enforced transition table, each change a compare-and-swap (`UPDATE … WHERE status = ?`), so two simultaneous taps cannot both win.
- Every quote is a numbered `quote_revision`; a new send supersedes the old one but keeps it. The traveller only ever receives `public_view`, never engine internals.
- Accept is bound to a `revisionId` (a stale accept gets 409). The accepted total is computed by the Worker, never taken from the client.
- A timeline (`request_event`) with agency-only internal notes.
- Payments: deposit/balance/full, Razorpay order per payment, webhook as source of truth.

## The loop, and who owes the next move

```
traveller sends ─► pending ─► in_review ─► quoted ─► accepted ─► part_paid ─► paid
                                 ▲           │  ▲        │
                                 │           ▼  │        └─ staff may re-open (clears acceptance)
                                 └── changes_requested
exits: declined · expired · cancelled · closed
```

| Status | Owes the move | Traveller sees (app) | Staff sees (app) | Push |
|---|---|---|---|---|
| pending | staff | "Request received" | top of **Your move** queue | staff: new request |
| in_review | staff | "Being prepared" | **Your move**, draft badge | none (avoid noise) |
| quoted | traveller | quote offer: Accept · Ask a question · Request changes · Decline | **Waiting on traveller**, validity countdown | traveller: quote ready |
| changes_requested | staff | "Revision requested" + their message | **Your move**, their message pinned | staff: changes requested |
| accepted | traveller | **Pay now** | Waiting, "accepted, not paid" | staff: accepted |
| part_paid | traveller | "Balance due" | Waiting | staff: payment received |
| paid | none | "Booking confirmed" | Done | traveller + staff |
| expired | staff | "Quote expired, message us" | **Your move** | traveller: expired |
| declined / cancelled / closed | none | final | Done | none |

## Gaps found in the loop, and the fixes

| # | Gap | Evidence | Fix |
|---|---|---|---|
| N1 | **A retried "send quote" creates a duplicate revision and sends the email twice.** On a phone, a lost response is routine (lift, tunnel), and the staff member taps Send again. | **Reproduced**: two identical sends gave `v1 superseded` + `v2 sent`, `200` both times. The CAS allows `quoted→quoted`, and the draft is consumed by the first send | Required `Idempotency-Key` header on `/send`, `/accept`, `/pay`, `/requests` and `/enquiries` (create). Worker stores `key → response` in KV for 24 h and replays the stored response. The app generates the key when the screen opens and reuses it on retry |
| N2 | **Two people (or phone + laptop) overwrite each other's draft silently.** | **Reproduced**: second stale save replaced the first (`note` = the stale one), no warning | `/draft` takes `baseUpdatedAt`; if the stored draft is newer, `409` with the latest draft. App shows "Priya saved a newer draft 2 min ago: Review / Overwrite". `/send` takes the same precondition |
| N3 | **No way to ask a question without changing state.** The only traveller message is "request changes" (one text, only while `quoted`), which flips the turn to staff. A question therefore goes to WhatsApp, outside the record | `handleRequestChanges`; `EVENT_TYPES` has no `message` | `POST /requests/:id/messages` (traveller) and `POST /admin/requests/:id/messages` (staff). New event type `message`, **does not change status**, allowed in any non-terminal status, 1000 chars, 20/day, pushes the other side. The web timeline already renders unknown event types by `summary` [Likely: check in the spike] |
| N4 | "Request changes" is free text only, so staff must read and classify | same | Optional chips **Dates · Hotels · Activities · Budget · Other** prefixed into the same event summary. No schema change |
| N5 | **Nothing shows what changed between v1 and v2**, the single most useful thing in a negotiation | `public_view` is stored per revision [Certain] | Client-side diff of two `public_view`s: total delta, per-category delta, validity, agency note. Itinerary-level diff is Phase 2 |
| N6 | Re-opening an **accepted** quote silently clears the acceptance | `handleAdminSendQuote` resets `accepted_*` when `from === "accepted"` | Staff gets a blocking confirm ("Asha already accepted v2. Sending a new quote clears that and she must accept again"). Traveller push says so in plain words |
| N7 | **Expiry only happens when someone reads the request**, and the admin list does this per row (up to 300 reads that can write) | `refreshExpiry`; no `[triggers]` in either wrangler config | Cloudflare **Cron Trigger** every 15 min: expire lapsed quotes, send "expires tomorrow" (traveller) and "waiting 24 h" (staff) pushes. Remove the per-row write from the list path |
| N8 | **After payment there is no cancel/refund path** (`paid → []`, `part_paid → paid, closed`) | `TRANSITIONS` | **Decided for v1: out of scope, WhatsApp hand-off.** App v1: "Need to change or cancel?" opens WhatsApp prefilled with the booking reference; staff record a note. Refunds stay in Razorpay's dashboard |
| N9 | **No balance due date.** `part_paid` has no deadline or reminder | `payment` table has none | **Decided for v1: out of scope.** Staff note + manual message; a due date and reminders become a post-launch change if wanted |
| N10 | Push bodies show on the lock screen and transit Expo/Apple/Google servers | design | Push carries a generic title and an id only: "Your quote is ready", never a name, phone or amount. Detail loads after unlock |

## Staff screens

Staff tab appears only when `GET /auth/me` returns `admin: true` (already returned [Certain: `auth.ts`]). The server enforces everything; the tab is a convenience.

1. **Queue** (home of Staff). Segments: **Your move** (pending, changes_requested, in_review, expired), **Waiting** (quoted, accepted, part_paid), **Done**. Row: destination, nights, travellers, estimate, age ("waiting 3 h"), status chip. Pull to refresh. Badge on the tab.
2. **Request detail**. Header actions: **Call**, **WhatsApp** (prefilled "Hi {first name}, about your {destination} quote…"), **Email**. Traveller note, trip summary, timeline with internal notes visibly different (lock icon, tinted), payments list, revisions list with the diff view (N5).
3. **Quote editor** (the heavy one), three sections:
   - **Trip**: the same four planner steps plus the full Fine-tune sheet in "expert mode" (every control the web `DecisionMatrix` exposes). Any change re-prices on device.
   - **Pricing**: pinned package price, extra lines (optional or mandatory, discounts), deposit, validity date, note to traveller. A bar always shows **Engine ₹X → Final ₹Y**.
   - **Price split** (admin only, per the earlier requirement): each category expands into its line items with a checkbox per line (`excludedLineKeys`/`excludedLineItems`); unticking lowers the total live. The traveller never sees the split.
   Autosave draft (debounced 3 s, with a local copy if offline), then **Preview as traveller** and **Send** (summary sheet, N6 confirm when needed).
4. **Leads**. Chat/contact enquiries need a new `GET /admin/enquiries` (none exists today [Certain: route table]); each lead has Call · WhatsApp · Mark handled. Package requests (`/admin/package-requests`) appear in the same list with their quote/close actions.
5. **Notes** are inline in the timeline. Close request with a reason.

## Delivery stages (staff mode is the largest single scope increase)

| Stage | Contents | When |
|---|---|---|
| S1 Triage and respond | queue, detail, notes, call/WhatsApp/email, start review, close, messages, push | MVP |
| S2 Send a revision | send the existing draft or a pinned total, validity, note, idempotent send, N6 confirm | MVP |
| S3 Full editor | on-device re-pricing in expert mode, price split with line toggles, preview | before public launch; staff keep using the web editor for heavy edits until then |

Estimate: S1 about 1 week, S2 half a week, S3 2 to 3 weeks, messages + push + cron about 1 week **[Guessing]**. Staff mode adds roughly 4 to 5 weeks overall.

The risk is S3: the web editor is 1,053 lines across four components (`AdminQuoteEditor` 329, `AdminRequestDetail` 385, `PricingPanel` 216, `PriceSplitPanel` 123) plus the entire planner. A phone is a worse place to author a complex quote than a laptop. The app optimises for **responding fast** (S1, S2); S3 makes the phone sufficient, and the web editor remains the better tool for a long multi-line rewrite.

## Security of the staff tier

- **One session reader.** `getSessionUser` (`auth.ts:85`) and `getAdminUser` (`admin.ts:26`) are two separate copies that both read the cookie and compare the plaintext session id [Certain]. Adding bearer tokens to only one would make travellers work on mobile while every admin call silently returns 404. Both must call a single `readSession()`; a test greps that no other code reads the session cookie.
- **Who counts as staff** is unchanged, and the app adds no list of its own: whoever can sign in to the existing web admin sees every request in the app, and nobody else can. Access is managed where it is today (`ADMIN_EMAILS`). Rule: email in `ADMIN_EMAILS`, and either Google-only or a password proven through the emailed reset link (`password_verified_at`) [Certain]. **Staff therefore do not need Google or Apple sign-in in the app**: they set a password once through the reset email on the web, then sign in with email and password.
- Staff sessions expire in **7 days** (travellers 30), set at login for admin emails.
- **Biometric re-lock** after 2 minutes in the background (`expo-local-authentication`; test on a dev build because Expo Go's Face ID support is limited [Likely]).
- **Screen-capture protection** on staff screens (`expo-screen-capture`) [Likely].
- **Sign out everywhere**: `POST /auth/logout-all`, plus a documented one-line D1 command in the runbook for a lost phone.
- Every staff action is already attributed (`actorName = admin.email`) in the timeline [Certain].
- App Review: staff features are role-gated, documented in review notes, and the demo account is a traveller. If Apple objects to hidden features (guideline 2.3.1 [Likely]), the fallback is the same code built as a second internal-only app (`APP_VARIANT=staff`, separate bundle id, TestFlight and Play internal only). The staff screens are a self-contained route group so the split costs about 1 to 2 days [Guessing].

## Acceptance criteria

- Traveller on phone A and staff on phone B complete: request → review → quote v1 → question → changes → quote v2 → accept → pay (test mode) → paid, with a push at every hand-over and the right next action on each screen.
- Replaying any write with the same `Idempotency-Key` returns the original result and creates nothing new.
- A stale draft save returns 409 and loses no data.
- Killing the app mid-payment never shows "paid" unless the server says so.
- A non-staff bearer token on any `/admin/*` route returns 404, same as today.
