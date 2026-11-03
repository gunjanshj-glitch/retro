# 05. Testing and release

## Run it locally (your explicit requirement)

Everything runs on your machine against a local copy of the backend. No store accounts are needed for this stage.

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

Seed data: a script creates a test traveller, a quoted request in each status, and a paid one. Razorpay runs in **test mode** with test keys on the preview Worker only.

## Test layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Engine and shared logic | existing **Vitest** (515 tests) | pricing, itinerary, quote maths; unchanged | every PR |
| **Parity** | golden fixtures: 20 `QuoteRequest`s, expected totals; run under Node (Vitest) **and** on-device (Jest/Hermes) | web and phone produce identical prices | every PR |
| Backend | existing Worker tests + new ones per endpoint (bearer, exchange code replay, deletion, config) | doc 01 acceptance list | every PR |
| Components | **Jest** (`jest-expo`) + React Native Testing Library | planner steps, price bar, auth sheet, chat flow | every PR |
| Contract | shared zod schemas: client and Worker compile against the same types | request/response drift | compile time |
| **End-to-end** | **Maestro** (YAML flows on emulator or device) [Likely: standard OSS choice for Expo] | guest browse → plan → quote; sign-in gate; request quote; accept; pay in test mode; offline launch; delete account | nightly + before release |
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

1. **Accounts** (start now; they are the long pole): Apple Developer Program US$99/yr (organisation enrolment needs a D-U-N-S number and can take days to weeks [Likely]); Google Play Console US$25 once. Google requires **new personal accounts to run a closed test with at least 12 testers for 14 days** before production [Likely: policy introduced Nov 2023; organisation accounts are exempt]. Plan for it.
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
| Reviewer cannot sign in | Apple 2.1 | Demo account + notes; guest browsing works without one |
| Push permission asked at launch | usability + approval | ask after the first quote request, with a reason |
| Broken links or placeholder content | 2.1 | Content from live catalogue; offline-safe |
| Crashes | 2.1 | Sentry; release gating on crash-free sessions |

## CI (GitHub Actions) [Likely]
On PR: lint, `tsc`, Vitest (web + core + parity), Jest (app), Worker tests. On tag `mobile-v*`: EAS build for both platforms, submit to TestFlight / Play internal. Maestro suite nightly on an emulator. Lighthouse CI continues to guard the web only.

## Rough running cost
Cloudflare: unchanged (static assets + Workers + D1 free tiers cover current volume [Likely]; watch D1 reads once images/catalogue downloads grow). Apple US$99/yr, Google US$25 once. EAS: free tier to start. Sentry: free tier. Expo push: free. WhatsApp Cloud API: only in Phase 2, per message.
