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
| `/admin/*` | agency review, edit, send | out of scope for v1 (Google-only admin) |

## Blockers, ranked

### B1. Sessions are cookie-only
`getSessionUser` reads the `atlas_session` cookie (`HttpOnly; Secure; SameSite=Lax`). A native app can store cookies, but unreliably (OS clears, no jar sharing with the in-app browser, cannot be read for diagnostics). **Fix:** accept `Authorization: Bearer <token>` in addition to the cookie, and return the token in the JSON body only when the client sends `X-Client: mobile`. Same `session` table, same 30-day TTL. The web is unaffected.

While there: session ids are stored **in plaintext** as the token [Certain: `INSERT INTO session (id …)` and `WHERE s.id = ?`]. A database read exposes live sessions. **Fix:** store `sha256(token)`, with a one-time migration that expires old sessions (users sign in once more).

### B2. Social login is a web redirect
`/auth/google/start` redirects to Google and the callback sets a cookie then redirects to a web path. In an app this needs:
- **Mobile return:** `start?client=mobile&redirect=retro://auth` and a callback that, instead of a cookie, redirects to `retro://auth?code=<one-time code>`; app calls `POST /auth/mobile/exchange {code}` to get the bearer token. One-time code: 60 seconds, single use, stored in the existing `oauth_state`-style table. The app opens the flow in `ASWebAuthenticationSession` / Custom Tabs via `expo-auth-session` (never a raw webview; Google blocks those).
- **Sign in with Apple (mandatory):** App Store guideline 4.8 requires an equivalent privacy-preserving login option wherever a third-party login (Google) is offered [Likely: wording changed in 2024, compliance is still safest through Apple]. New endpoint `POST /auth/apple {identityToken, name?}` verifies Apple's JWT against Apple's public keys, then merges by email like Google does (note Apple may supply a private relay address).
- Facebook stays disabled (the Worker has `FACEBOOK_ENABLED = false`). X: keep off the app until asked for.

### B3. No account deletion
Apple guideline 5.1.1(v) requires in-app account deletion; Google Play requires a data-deletion route [Likely]. The web only has a static `/data-deletion` page. **Fix:** `DELETE /auth/account` (re-auth by password or fresh token), which deletes sessions and user, anonymises `quotation_request`/`package_request` rows needed for the agency's accounting (keep amounts, drop name/email/phone), and records a `request_event`.

### B4. Payments assume a browser
`/requests/:id/pay` returns what Razorpay Checkout.js needs. **Decision:** do not add Razorpay's React Native SDK (native module, forces a custom dev client, breaks Expo Go). Instead the Worker serves a small hosted page `GET /pay/:id?token=…` that loads Checkout.js, and the app opens it with `expo-web-browser`. On success the page calls the existing verify endpoint and redirects to `retro://pay-result?status=…`. UPI intent apps (GPay, PhonePe) work from Checkout.js on Android [Likely]; verify on iOS in test mode [Guessing]. Apple permits non-IAP payment for real-world travel services (guideline 3.1.3(e)) [Likely], and travel is the textbook case.

### B5. No way to tell the app to update, or to switch things off
**Fix:** `GET /app-config?platform=ios&version=1.0.3` returns `{ minVersion, latestVersion, maintenance, whatsapp, phone, flags, catalogueVersion }`. The app shows a blocking "please update" screen below `minVersion`. This is the safety net that lets the backend evolve without stranding installed apps. Cache 5 minutes at the edge.

### B6. No push notifications
Needed for "your quote is ready", "payment received". **Fix:** table `device(id, user_id, platform, expo_push_token, app_version, created_at, last_seen)`; `POST /devices`, `DELETE /devices/:id`; a small `notify(userId, title, body, deepLink)` helper that posts to Expo's push API (free) and is called from `request-admin.ts` where the email is sent today. Email stays as fallback. Staff alerting: send a push to registered staff devices on new leads (Phase 2).

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
| O9 | **Consistent error shape** `{error, code}`; today messages only | The app needs a machine-readable `code` (e.g. `AUTH_REQUIRED`, `RATE_LIMITED`) to react without string matching |

## What does NOT change

- D1 schema for requests, quotes, payments, events.
- Pricing engine location (client-side, shared).
- Admin workflow and its Google-only access.
- The web app. Every change above is additive; the web keeps cookies.

## Migration plan (Phase 0, about one week [Guessing])

1. `0007_mobile.sql`: `device` table, `mobile_auth_code` table, hashed-session column + backfill-by-expiry.
2. Auth: bearer support, `/auth/mobile/exchange`, `/auth/apple`, `DELETE /auth/account`. Tests extend `tests/unit/workers-api.test.ts` (existing harness).
3. `/app-config`, `/devices`, `/pay/:id` page, `/api/v1` alias.
4. ETL: manifest and image variants. `.well-known` files.
5. Deploy to **preview** first; the first mobile builds point at `atlas-api-preview`.

Acceptance: web regression suite (515 tests today) unchanged and green, plus new tests for each endpoint, including: expired bearer → 401, replayed exchange code → 400, account deletion removes PII but keeps payment records.
