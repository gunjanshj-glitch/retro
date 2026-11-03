# 01. Backend reuse and optimisation

## What exists [Certain: read from `workers/api` and `wrangler.toml`]

Two Workers. `atlas-web` serves the static Next.js export and forwards `/api/*` to `atlas-api` over a service binding. `atlas-api` uses D1 (`DB`) and KV (`RATE_CACHE`). A preview twin (`atlas-api-preview`, own D1) already exists, which the app will use for internal builds.

The key architectural fact: **the catalogue and the pricing engine are not on the server.** `public/atlas/*.json` (core 2.9 MB, routes 1.6 MB, visa 148 KB, 430 per-place bundles ≈ 11 MB, guidance ≈ 11 MB) are static files and the engine runs in the client. The Worker holds only state and secrets. That is good news: the app needs no new "catalogue API".

### Endpoint inventory and mobile readiness

| Endpoint | Purpose | Mobile ready? |
|---|---|---|
| `GET /health`, `GET /live-rates` | health, upstream rates | yes |
| `POST /enquiries` | contact/lead capture (honeypot, source enum) | yes, add `app-chat` and `web-chat` sources |
| `POST/GET /quotes` | saved quote snapshot | yes |
| `POST /auth/register, login, forgot, reset, logout`, `GET /auth/me` | email auth | **no: cookie-only** |
| `GET /auth/{google,x}/start|callback`, `GET /auth/providers` | social login | **no: web redirect, cookie** |
| `POST/GET /requests`, `GET /requests/:id`, `POST …/accept|changes|decline|cancel` | trip quote workflow | yes once auth is solved |
| `POST /requests/:id/pay`, `…/pay/verify`, `POST /webhooks/razorpay` | Razorpay | **partly: assumes browser Checkout.js** |
| `POST/GET /package-requests` | quote request for a fixed package | yes once auth is solved |
| `GET /admin/requests`, `GET/POST /admin/requests/:id/{review,draft,send,note,close}` | staff review, edit, send a revision | **yes once B1 is fixed**: staff mode is in scope (doc 07). Needs B8 and B9 first |
| `GET /admin/package-requests`, `POST …/quote|close` | package quotes | yes once B1 is fixed |
| *(none)* `GET /admin/enquiries` | chat/contact leads for staff | **missing**: add (doc 07) |

## Blockers, ranked

### B1. Sessions are cookie-only, and read in two places
`getSessionUser` (`auth.ts:85`) **and** `getAdminUser` (`admin.ts:26`) each read the `atlas_session` cookie and compare the plaintext id [Certain]. A native app can store cookies, but unreliably (OS clears, no jar shared with the in-app browser, cannot be read for diagnostics). **Fix:** one `readSession(request, env)` used by both, accepting `Authorization: Bearer <token>` in addition to the cookie; the token is returned in the JSON body only when the client sends `X-Client: mobile`. If only `getSessionUser` were changed, travellers would work on mobile while every staff call silently returned 404. A unit test greps the Worker source so that no other code reads the session cookie. Same `session` table; 30-day TTL for travellers, **7 days for staff emails**. The web is unaffected.

Session ids are also stored **in plaintext** [Certain: `INSERT INTO session (id …)`, `WHERE s.id = ?`]; a database read exposes live sessions. **Fix:** store `sha256(token)`. Migrate with a **dual lookup** (hash first, then the legacy plaintext id for up to 30 days, re-hashing on use), not a mass expiry, so nobody mid-payment or mid-quote is signed out.

### B2. Social login is a web redirect
`/auth/google/start` redirects to Google and the callback sets a cookie then redirects to a web path. In an app this needs:
- **Mobile return:** `start?client=mobile&redirect=<app link>&code_challenge=<S256 of an app-held verifier>` and a callback that, instead of a cookie, redirects to `<app link>?code=<one-time code>`; the app calls `POST /auth/mobile/exchange {code, code_verifier}` to get the bearer token. The code is single use, valid 60 seconds, stored in the existing `oauth_state`-style table, **and bound to the challenge**. Binding matters: custom URL schemes are not exclusive to one app, so without the verifier any other app that registers `retro://` could redeem a stolen code (RFC 8252 [Certain: standard guidance]).
- **Redirect allow-list.** Production accepts exactly `retro://auth` and the https app link. `exp://` and `exp+retro://` redirects (what Expo Go uses, since its scheme is `exp`, not `retro`) are accepted **only** on the dev and preview Workers, via an `ALLOW_EXPO_GO_REDIRECTS` variable that is absent in production. Without this, either local testing is blocked or production has an open redirect.
- The app opens the flow in `ASWebAuthenticationSession` / Custom Tabs via `expo-auth-session` (never a raw webview; Google blocks those).
- **Sign in with Apple (required only if Google is offered):** App Store guideline 4.8 requires an equivalent privacy-preserving login option wherever a third-party login is offered [Likely: wording changed in 2024, compliance is still safest through Apple]. New endpoint `POST /auth/apple {identityToken, name?}` verifies Apple's JWT against Apple's public keys, then merges by email like Google does (Apple may supply a private relay address). It cannot be tested until the Apple account exists (doc 08), so it ships behind the `appleSignIn` flag. **If Apple is late, launch with email and password only**; 4.8 then does not apply.
- **Staff do not need either.** Staff sign in with email and password once their address is verified through the reset email (`password_verified_at`), which `getAdminUser` already accepts [Certain].
- Facebook stays disabled (the Worker has `FACEBOOK_ENABLED = false`). X: keep off the app until asked for.

### B3. No account deletion
Apple guideline 5.1.1(v) requires in-app account deletion; Google Play requires a data-deletion route [Likely]. The web only has a static `/data-deletion` page. **Fix:** `DELETE /auth/account` (re-auth by password or fresh token), which deletes sessions and user, anonymises `quotation_request`/`package_request` rows needed for the agency's accounting (keep amounts, drop name/email/phone), and records a `request_event`. Staff addresses (`ADMIN_EMAILS`) cannot self-delete in the app; that is an environment change.

### B4. Payments assume a browser
`/requests/:id/pay` returns what Razorpay Checkout.js needs. **Decision:** do not add Razorpay's React Native SDK (native module, forces a custom dev client, breaks Expo Go). Instead the Worker serves a small hosted page `GET /pay/:id?t=<pay token>` that loads Checkout.js, and the app opens it with `expo-web-browser`. The `t` value is **not** the session token (URLs are logged and cached): it is an HMAC-signed, single-purpose token bound to one request id and one user, valid 10 minutes, created by `POST /requests/:id/pay` (which keeps its `Idempotency-Key`). The page calls the existing verify endpoint and redirects to `retro://pay-result?status=…`. **The redirect is a hint, never proof**: the app shows "Confirming your payment" and polls `GET /requests/:id` (up to 60 s) for `paid_inr` to rise, because the webhook is the source of truth [Certain: `settlePayment`]. If it does not rise, the app says it is still confirming and a push arrives when the webhook lands. Never show "Paid" from the redirect alone. UPI intent apps (GPay, PhonePe) work from Checkout.js on Android [Likely]; verify on iOS in test mode [Guessing]. Apple permits non-IAP payment for real-world travel services (guideline 3.1.3(e)) [Likely], and travel is the textbook case.

### B5. No way to tell the app to update, or to switch things off
**Fix:** `GET /app-config?platform=ios&version=1.0.3` returns `{ minVersion, latestVersion, maintenance, whatsapp, phone, flags, catalogueVersion }`. The app shows a blocking "please update" screen below `minVersion`. This is the safety net that lets the backend evolve without stranding installed apps. Cache 5 minutes at the edge.

### B6. No push notifications (now Phase 1: the negotiation depends on them)
The quote negotiation (doc 07) hands the move back and forth between two people; without push, each side only finds out when they next open the app or read an email. **Fix:** table `device(id, user_id, platform, expo_push_token, app_version, created_at, last_seen)`; `POST /devices`, `DELETE /devices/:id`; a `notify(userId, kind, requestId)` helper that posts to Expo's push API (free) and is called wherever `sendNotice` is called today (`requests.ts`, `request-admin.ts`, `payments.ts`, `enquiries.ts`). Email stays as the fallback and the only channel before a device registers. Rules: **generic text and an id only** (the lock screen and three vendors see it), coalesce to at most one push per request per 2 minutes, read Expo receipts and delete tokens that return `DeviceNotRegistered`. Staff recipients are users whose email is in `ADMIN_EMAILS`, checked at send time, not at registration.

### B7. Writes are not safe to retry
**Reproduced by test:** sending the same admin quote twice returns `200` both times and produces `v1 superseded` + `v2 sent` plus a second email, because the compare-and-swap allows `quoted→quoted` and the draft is consumed by the first send. Create endpoints (`POST /requests`, `/enquiries`) have no idempotency either, and `/requests` rate-limits to several per hour, so a legitimate retry after a dropped response can be blocked. Mobile networks make lost responses routine. **Fix:** `Idempotency-Key` header on every non-GET that creates or sends (`/requests`, `/enquiries`, `/admin/requests/:id/send`, `…/accept`, `…/pay`, `…/messages`). The Worker stores `key → status + body` in KV for 24 h and replays it. Same key, different body → `422`. The shared `api-client` generates a key per user action and reuses it on retry.

### B8. Staff draft saves overwrite each other
**Reproduced by test:** two drafts saved from stale copies, the second silently replaced the first. **Fix:** `/draft` and `/send` accept `baseUpdatedAt`; if the stored draft is newer the Worker returns `409 {code: "DRAFT_CHANGED", draft}` and the app offers Review or Overwrite.

### B9. No scheduled work
Expiry runs only when a request is read; the staff list does it per row (up to 300 rows, some writing) [Certain: `refreshExpiry`]. No reminders are possible. **Fix:** a Cloudflare Cron Trigger (every 15 minutes) that expires lapsed quotes, and sends "expires tomorrow" and "waiting 24 h" pushes. The list path then only reads.

### B10. No free-form message, no staff lead list
Add `POST /requests/:id/messages` (traveller) and `POST /admin/requests/:id/messages` (staff) with event type `message` that does not change status, and `GET /admin/enquiries` for the Leads screen. Details in doc 07, N3.

## Optimisations (not blockers)

| # | Change | Why |
|---|---|---|
| O1 | **Catalogue manifest** `public/atlas/manifest.json` `{version, files:{path:{hash,bytes}}}` emitted by `scripts/etl/build.ts` | App downloads only changed files; knows when its offline copy is stale. Cloudflare already serves static assets with ETag and compression |
| O2 | **Pre-generated image variants** (480/960/1440 px WebP) in the ETL. Today `public/packages` is 37 MB of full-size art | A 1440 px hero on a phone card wastes data. Pre-generated beats on-the-fly resizing: free, deterministic, can be bundled offline |
| O3 | **Version the API**: serve the same handlers at `/api/v1/*` and keep `/api/*` as an alias | Lets a future breaking change ship as `/v2` while old installed apps keep working for months |
| O4 | **Shared contracts package** (zod schemas for every request/response) used by Worker, web and app | One definition; mismatches become compile errors instead of production bugs |
| O5 | **Rate limits on auth**: only enquiry and request endpoints have counters today [Certain: grep]. Add a Cloudflare rate-limiting rule on `/api/auth/*` and `/api/enquiries` | A public mobile API gets scripted. Free rules cover this |
| O6 | **Cache policy**: `Cache-Control` for `/atlas/*` (immutable by hash) and `/app-config` (5 min) | Fewer origin hits, faster cold start |
| O7 | **Observability**: Sentry (RN) for crashes; Worker logs already on | You cannot debug a crash on a stranger's phone without it |
| O8 | **Universal links**: serve `/.well-known/apple-app-site-association` and `assetlinks.json` from `public/` | Password-reset and "your quote is ready" emails open the app, not the browser |
| O9 | **Consistent error shape** `{error, code}`; today messages only | The app needs a machine-readable `code` (e.g. `AUTH_REQUIRED`, `RATE_LIMITED`, `DRAFT_CHANGED`, `QUOTE_SUPERSEDED`) to react without string matching |
| O10 | **Catalogue and engine version stamp** on every submitted `QuoteRequest` snapshot | Phone, web and staff can price on different catalogue versions. Staff see "priced on catalogue v12, current v14" and re-price knowingly; the quote screen shows the version |
| O11 | **Server-side price check** (later): run the shared engine in the Worker on submit and store `serverTotal` | A modified client can submit any total. Staff review before sending so this is not a v1 blocker, but a flag for large mismatches is cheap once the engine is a package |

## What does NOT change

- D1 schema for requests, quotes, payments, events (additive tables only).
- Pricing engine location (client-side, shared).
- The status machine and the admin endpoints' behaviour; the app is a new client for them. The admin rule (email in `ADMIN_EMAILS` and a proven address) is unchanged; note it allows a verified password, not only Google.
- The web app. Every change above is additive; the web keeps cookies.

## Migration plan (Phase 0, about two weeks with the safety work [Guessing])

0. **Before touching anything:** `wrangler d1 export` of production, and note D1's point-in-time restore window [Likely: 30 days; confirm]. All migrations are additive, so rollback means ignoring the new tables, not restoring.
1. `0007_mobile.sql`: `device`, `mobile_auth_code` (with `code_challenge`), idempotency records live in KV (`RATE_CACHE`), not D1; `session.token_hash` column with dual lookup.
2. **`readSession()` refactor first, with the existing 515 web tests green and cookie behaviour byte-identical**, then bearer, then hashing. Three separate commits.
3. Auth: `/auth/mobile/exchange`, `/auth/apple` (flagged), `DELETE /auth/account`, `/auth/logout-all`.
4. Safety: `Idempotency-Key` (B7), `baseUpdatedAt` (B8), Cron Trigger (B9).
5. Product: `/app-config`, `/devices` + `notify()`, `/pay/:id` page + signed token, messages + `/admin/enquiries` (B10), `/api/v1` alias.
6. ETL: manifest and image variants. `.well-known` files wait for Gate A (doc 08).
7. Deploy to **preview** first; the first mobile builds point at `atlas-api-preview`. Production only after M3 passes on preview.

Acceptance: web regression suite unchanged and green, plus per-endpoint tests that run each **under both cookie and bearer**: expired bearer → 401; another user's request → 404; non-staff token on `/admin/*` → 404; replayed exchange code → 400; code without the matching verifier → 400; `exp://` redirect rejected when `ALLOW_EXPO_GO_REDIRECTS` is unset; replayed idempotency key returns the stored response and creates nothing; stale draft → 409; account deletion removes PII but keeps payment records.
