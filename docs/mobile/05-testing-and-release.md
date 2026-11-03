# 05. Testing and release

## Run it locally (your explicit requirement)

Everything runs on your machine against a local copy of the backend. **No store accounts are needed** (what needs which account is in doc 08).

```bash
# Terminal 1: backend, with a local D1 database that persists between runs
npm run cf:d1:migrate:local
npx wrangler dev --env="" -c workers/api/wrangler.toml --persist-to .wrangler/state --ip 0.0.0.0 --port 8787

# Terminal 2: the app
cd mobile
EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:8787 npx expo start
```

| Where you test | How | Notes |
|---|---|---|
| **Real iPhone or Android phone** (best) | Install **Expo Go**, scan the QR code on the same Wi-Fi | No Mac required. `@expo/ui` works in Expo Go on SDK 56+ [Certain: Expo docs]. Use this daily |
| **Android emulator** | Android Studio AVD; API URL `http://10.0.2.2:8787` | Works on Windows, macOS, Linux |
| **iOS simulator** | needs a Mac with Xcode | Without a Mac, test iOS on a real iPhone (Expo Go, then TestFlight builds from EAS cloud) |
| **HTTPS when needed** (OAuth, payments return) | `cloudflared tunnel` to the local Worker, or point at `atlas-api-preview` | Social login and Razorpay need a public HTTPS URL |
| **Custom native code** (only if added later) | `eas build --profile development`, installs a dev client | Avoided on purpose so Expo Go keeps working |
| **Android push** | development build (EAS with a free Expo account, or local with Android Studio) plus a Firebase key | remote push does not work in Expo Go on Android since SDK 53 [Certain: vendored skill]. No Play account needed |

**Seed data** (`scripts/mobile-seed.ts`, one command): a test traveller; a **staff** user whose address is in the local `ADMIN_EMAILS` with `password_verified_at` already set (so the reset-email step is skipped locally); one request in each of the 11 statuses; a quote with two revisions so the diff view has data; a paid booking. The local mailer logs to the console instead of sending.

**Two-actor testing without two phones:** the seed script also exposes `npm run mobile:act -- staff send-quote <id>` etc., which call the same Worker endpoints as the staff app. You test the traveller flow on your phone while the script plays staff, and the reverse. With two phones (or a phone and the Android emulator) you can run both apps for real.

**Local pitfalls, so they cost you minutes not hours:** the Worker must listen on `0.0.0.0` and the computer's firewall must allow port 8787; `localhost` on a phone is the phone itself; Android release builds block cleartext HTTP, so dev builds need `usesCleartextTraffic` through `expo-build-properties` for development only; iOS needs a local-network exception in dev builds (Expo Go has one); a corporate or guest Wi-Fi that isolates clients breaks LAN testing, in which case use a `cloudflared` tunnel. Razorpay runs in **test mode** with test keys on the preview Worker only, and its return needs an HTTPS URL, so test payments through the tunnel or the preview Worker.

## Test layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Engine and shared logic | existing **Vitest** (515 tests) | pricing, itinerary, quote maths; unchanged | every PR |
| **Parity** | golden fixtures: 20 `QuoteRequest`s, expected totals; run under Node (Vitest) **and** on-device (Jest/Hermes) | web and phone produce identical prices | every PR |
| Backend | existing Worker tests + new ones per endpoint, **each under cookie and bearer** | doc 01 acceptance list: replay, stale draft, idempotency, IDOR, redirect allow-list, exchange-code binding | every PR |
| **Negotiation** | Worker-level scenario tests walking every legal and illegal status transition from both actors | doc 07 loop, including retry of every write, N6 re-open, expiry by cron | every PR |
| Components | **Jest** (`jest-expo`) + React Native Testing Library | planner steps, price bar, auth sheet, chat flow | every PR |
| Contract | shared zod schemas: client and Worker compile against the same types | request/response drift | compile time |
| **End-to-end** | **Maestro** (YAML flows on emulator or device) [Likely: standard OSS choice for Expo] | guest browse → plan → quote; sign-in gate; request quote; **full negotiation with the scripted staff actor**; pay in test mode; payment return lost (kill app mid-pay); offline launch; delete account | nightly + before release |
| Failure injection | Maestro + a flaky-network proxy in the dev Worker (drop every Nth response) | no duplicate revisions, requests or leads; no lost drafts or messages | before release |
| Accessibility | VoiceOver/TalkBack manual script + automated label lint | doc 03 criteria | each release |
| Performance | cold start, JS bundle, map FPS on a **low-end Android** | budgets in doc 03 | each release |

Device matrix for release sign-off: iPhone SE (small), a current iPhone, a low-RAM Android (4 GB or less), a current Pixel/Samsung, Android 12 and the newest OS, one tablet for the centred-column layout.

## Environments

| Env | Backend | Distribution | Audience |
|---|---|---|---|
| development | local Wrangler | Expo Go / dev client | you, developers |
| **preview** | `atlas-api-preview` (own D1, test Razorpay) | EAS internal distribution (Android APK link; iOS ad-hoc/TestFlight internal) | you, staff |
| **production** | `atlas-api` | App Store / Play | public |

## Release pipeline

1. **Accounts**: not needed to build or test (doc 08), but enrolment is the long pole for launch. Apple Developer Program US$99/yr (organisation enrolment needs a D-U-N-S number and can take days to weeks [Likely]); Google Play Console US$25 once. Google requires **new personal accounts created after 13 Nov 2023 to run a closed test with at least 12 testers for 14 continuous days** before an app can go to production; **organisation accounts with a D-U-N-S number are exempt** [Likely: several secondary sources agree, Google's own page could not be fetched]. The rule is per new app, so a personal account pays the 14 days once for this app.
2. **Identity**: bundle id `in.retroholidays.app` (iOS) and package `in.retroholidays.app` (Android), URL scheme `retro`, associated domains `retroholidays.in`.
3. **Build**: **EAS Build** in the cloud (no Mac needed). `eas.json` profiles development / preview / production. Version = semver; build numbers auto-increment. Free EAS tier has limited builds per month [Likely]; budget a paid plan once you build often [Guessing].
4. **Beta**: iOS **TestFlight** (internal testers instantly; external needs a short Beta App Review). Android **Play internal testing**, then closed testing.
5. **Submit**: `eas submit` (skill `eas-app-stores`). iOS: **phased release** (7-day ramp). Android: **staged rollout** 10% → 50% → 100%.
6. **Hotfixes without review**: **EAS Update** pushes JavaScript fixes over the air to the right channel (preview/production); native changes still need a store build. Use `runtimeVersion` tied to app version so an update never reaches an incompatible binary.
7. **Kill switch**: `/app-config` `minVersion` forces upgrades if a bad version ships (doc 01, B5).

### Store listing assets (prepare during build)
App icon 1024 px; iPhone 6.9" and 6.5" screenshots (the mockup screens become these); Android phone screenshots and a 1024×500 feature graphic; short and long descriptions; keywords; support URL (`/contact`); privacy policy URL (`/privacy`); **data-deletion URL** (`/data-deletion`, exists); age rating questionnaire; **App Privacy** (iOS) and **Data safety** (Google) declarations listing name, email, phone, trip details, push token, crash data.

### Review risks and how the plan answers them

| Risk | Rule | Mitigation |
|---|---|---|
| Looks like a website in a frame | Apple 4.2 | Native UI; no wrapped site |
| Third-party login without Apple login | Apple 4.8 | Sign in with Apple built in (doc 01, B2) |
| No account deletion | Apple 5.1.1(v), Play data-deletion | `DELETE /auth/account` + in-app button |
| Payments outside IAP | Apple 3.1 | Real-world travel services are exempt (3.1.3(e)) [Likely]; explain in review notes |
| Reviewer cannot sign in | Apple 2.1 | Demo traveller account + notes; guest browsing works without one |
| Staff features look hidden | Apple 2.3.1 [Likely] | Role-gated, described in the review notes; fallback is the same code as an internal-only second app (doc 07) |
| Account required before it is needed | Apple 5.1.1 | Guest-first; sign-in only at quote request and My trips |
| Push permission asked at launch | usability + approval | ask after the first quote request, with a reason |
| Broken links or placeholder content | 2.1 | Content from live catalogue; offline-safe |
| Crashes | 2.1 | Sentry; release gating on crash-free sessions |

## Payment states in the app (the one flow where a wrong screen costs money)

`idle → opening → in browser → returned(success | cancelled | unknown) → confirming (poll ≤ 60 s) → paid | still confirming | failed`.
- Success is shown only when the server's `paid_inr` has risen; the redirect is a hint (doc 01, B4).
- A killed app or lost return resumes at `confirming` on next launch, because the open payment is read back from `GET /requests/:id`.
- A second tap on Pay reuses the same `Idempotency-Key`, so no second order is opened.
- Failure and cancellation show a clear retry and keep the quote accepted.
- Test with Razorpay test cards and a test UPI id on both platforms; UPI app switching from the in-app browser is verified on real devices [Guessing until tested].

## Compliance checklist (before the first store submission)

| Item | Detail |
|---|---|
| Privacy policy text | add the app, push tokens, chat leads, staff data, retention periods; link from both stores |
| Apple App Privacy / Google Data safety | list name, email, phone, trip details, push token, crash data; **no tracking**: the plan sends analytics through the Worker (Measurement Protocol) so no advertising ID is read and no ATT prompt is needed [Likely] |
| Apple privacy manifest | `PrivacyInfo.xcprivacy` generated by Expo; review required-reason APIs in the build |
| Export compliance | `ITSAppUsesNonExemptEncryption=false` (standard HTTPS only) [Likely] |
| Account deletion | in-app button → `DELETE /auth/account`; payment records retained as anonymised accounting data |
| Android | target the current required API level, edge-to-edge, 64-bit and the page-size rules; Expo's SDK handles these when kept current [Likely] |
| India data protection law | notice and consent at the chat and quote forms, purpose limits, deletion on request, retention schedule; confirm with counsel [Likely] |
| Content | store screenshots from the real app; no placeholder text |

## Operations after launch

- **Sentry** for crashes; Worker logs for 5xx; alert on webhook signature failures, push `DeviceNotRegistered` spikes, and any request whose payment is `created` for more than 30 minutes with no webhook.
- **Runbook** (one page): lost staff phone (`logout-all`, or the D1 command to delete that user's sessions), payment captured but not settled (re-send webhook from Razorpay dashboard, then the reconcile steps), bad release (raise `/app-config minVersion`, ship an EAS Update, or roll back), migration rollback (additive tables, restore window).
- **Release health gates**: crash-free sessions ≥ 99% [target] before widening a rollout.

## CI (GitHub Actions) [Likely]
On PR: lint, `tsc`, Vitest (web + core + parity), Jest (app), Worker tests. On tag `mobile-v*`: EAS build for both platforms, submit to TestFlight / Play internal. Maestro suite nightly on an emulator. Lighthouse CI continues to guard the web only.

## Rough running cost
Cloudflare: unchanged (static assets + Workers + D1 free tiers cover current volume [Likely]; watch D1 reads once images/catalogue downloads grow). Apple US$99/yr, Google US$25 once. EAS: free tier to start. Sentry: free tier. Expo push: free. WhatsApp Cloud API: only in Phase 2, per message.
