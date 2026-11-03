# 08. Building before the store accounts exist

You asked to develop and test first and integrate the Apple and Google accounts afterwards. That works for the code. It does not work for the calendar, and the difference decides the launch date.

## The part you may not want to hear

Deferring **the integration** is free. Deferring **the enrolment** is not, because three clocks only start when you enrol and none of them can be shortened by writing code faster [Likely]:

| Clock | Length | Source |
|---|---|---|
| Apple Developer enrolment | an individual is usually quick; an **organisation** needs a D-U-N-S number and can take days to weeks | Apple; duration is [Guessing] |
| Google Play **closed test** | a new **personal** account must keep **12 testers opted in for 14 continuous days** before it may publish an app; **organisation accounts with a D-U-N-S number are exempt** | secondary sources agree, Google's own page was not retrievable [Likely] |
| App review | iOS and Android each take days; first submissions are the slowest | [Guessing] |

So code-complete to public launch is at least **enrolment + 14 days (personal Play account) + review**, however fast development goes.

**I disagree with starting enrolment only after development ends.** The risk in that approach is a launch that slips 3 to 6 weeks for reasons unrelated to code. What I'd do instead: develop with no accounts exactly as you want, but **start enrolment at Milestone M3** (below). It is waiting, not work, and it costs nothing in development time. Whether you do is your call; the plan works either way, only the launch date moves.

Open question that changes the cost: **is Retro Holidays a registered company?** If yes, enrol both stores as an organisation (D-U-N-S is free from Dun & Bradstreet [Likely]) and the Google 14-day rule disappears.

## What each account unlocks, and what you do meanwhile

| Account | Cost | Needed for | Meanwhile |
|---|---|---|---|
| **Expo** (free) | free | EAS cloud builds, EAS Update, the push `projectId` | Expo Go needs none; create it at M4 |
| **Firebase** (free, any Google account) | free | Android push (FCM key) in dev and release builds | not needed before M4 |
| **Sentry** (free) | free | crash reports | add at M5 |
| **Apple Developer Program** | US$99/yr | TestFlight, development builds on a real iPhone, **Sign in with Apple**, APNs push in builds, universal links (needs Team ID), App Store | **Expo Go** on a real iPhone covers everything except those |
| **Google Play Console** | US$25 once | Play internal and closed testing, store listing, Play App Signing fingerprint for app links | install an **APK** from EAS or a local build; Android needs no store account to test |
| **Razorpay** | existing | payments | **test keys** on the preview Worker only |
| **Meta / WhatsApp Cloud API** | later | outbound notices | Phase 2 only; click-to-chat needs nothing |
| **Google Cloud OAuth** | existing web client | Google sign-in | reuse the web client; the flow is server-side so no mobile client id is needed [Likely] |

## What can be built and tested with no store account

| Capability | Testable now? | How |
|---|---|---|
| Browse, destinations, packages, map, planner, quote, offline | yes | Expo Go on iPhone and Android, local Worker |
| Email and password sign-in, request quote, trips, accept, changes, messages | yes | bearer tokens against local Worker |
| Staff mode S1 to S3 | yes | staff sign in with email and password; seed script marks the local admin as verified |
| Google sign-in | yes | system browser; redirect `exp://…` allowed on dev and preview Workers only (doc 01, B2) |
| Payment in test mode | yes | Worker-hosted pay page in the in-app browser; needs an HTTPS tunnel for the return |
| Chat lead and WhatsApp click-to-chat | yes | wa.me opens the real WhatsApp |
| iOS push | likely yes in Expo Go once an Expo project id exists [Likely] | |
| **Android push** | **no in Expo Go** (removed since SDK 53 [Certain: vendored Expo skill]) | a development build via EAS (free Expo account) or local build, plus a Firebase key. Still no Play account |
| **Sign in with Apple** | no | needs the Apple account; built behind a flag |
| **Universal links / app links** | no | need Team ID and signing fingerprint; push taps and in-app links use the `retro://` scheme meanwhile. Email links open the website |
| Face ID staff re-lock | not in Expo Go [Likely] | development build |
| TestFlight / Play internal distribution | no | accounts |

## Milestones and gates

| Milestone | Outcome you can test | Accounts needed |
|---|---|---|
| **M0 Foundation** | local Worker, seed data, app boots on your phone, engine parity test green, backend changes live on preview | none |
| **M1 Guest browse** | Explore, destinations, packages, map, planner, live quote, chat lead, offline | none |
| **M2 Account and request** | sign in, request a quote, Trips list, Google sign-in | none |
| **M3 Negotiation** | staff S1 + S2, quote offer, accept, changes, messages, test payment, polling updates | none. **Start enrolment here (recommended)** |
| **M4 Alerts and editor** | push (iOS in Expo Go, Android in a dev build), cron reminders, staff S3 editor | Expo + Firebase (free) |
| **M5 Hardening** | performance budgets, accessibility pass, Sentry, store assets, compliance text | Sentry (free) |
| **Gate A: accounts integration** | see below | Apple, Google Play |

### Gate A checklist (nothing here changes product logic; it is configuration)

| # | Step | What can go wrong |
|---|---|---|
| A1 | Enrol Apple Developer and Google Play (organisation if you can) | D-U-N-S delay; legal-name mismatch |
| A2 | Create bundle id `in.retroholidays.app` in both stores | name already taken [Guessing] |
| A3 | Upload APNs key and FCM key to EAS | wrong environment key |
| A4 | Turn on Sign in with Apple; deploy `POST /auth/apple`; flip `appleSignIn` flag in `/app-config` | Apple relay-email handling; test with a hidden address |
| A5 | Publish `/.well-known/apple-app-site-association` (Team ID) and `assetlinks.json` (Play App Signing SHA-256); switch email and push links from `retro://` to https | wrong fingerprint means links silently open the browser |
| A6 | First **TestFlight** build, internal testers | provisioning, entitlements |
| A7 | First Play **internal** build; then **closed test** (12 testers, 14 days on a personal account) | tester drop-off resets the clock |
| A8 | Privacy: iOS App Privacy answers, Play Data safety, privacy manifest, policy text | answers must match what the app does |
| A9 | Review notes: traveller demo account, explanation of staff features and payments | rejection for hidden features or payments |
| A10 | Phased rollout (iOS 7-day ramp, Android 10→50→100%) | monitor crash-free sessions |

**Fallback if Apple is late:** ship v1 with **email and password only** (no Google). Guideline 4.8 only applies when a third-party login is offered, so omitting Google removes the need for Sign in with Apple entirely [Likely]. Add Google and Apple together later as one change.

## How the code stays account-agnostic

- Auth is an interface with three providers (`email`, `google`, `apple`). `/app-config` flags decide which buttons appear; email is always on.
- Links go through one `resolveLink()`: `retro://` today, https universal links after A5. No call site changes.
- Push goes through one `registerForPush()`. Before Gate A it returns the Expo token where supported and `null` elsewhere; the app falls back to polling plus email, which is already how the website works.
- No custom native module is added, so Expo Go keeps working until the very end.
- `app.config.ts` reads `EAS_ENV`; account-specific values (team id, associated domains, push keys) are empty strings in dev and fail the release build loudly if still empty.

## One recommendation on early signal

Produce **one signed iPhone build at M3** (needs the Apple account) even if nothing else from Gate A is done. It exposes entitlement, push and payment-return problems 4 to 6 weeks before launch rather than during it. This is the cheapest insurance in the plan.
