# 06. Feature parity and roadmap

## Parity matrix: every web feature

| Web feature (source) | App | Phase | Notes |
|---|---|---|---|
| Home atlas hero, hero cards (`app`, `hero-cards.json`, `AtlasScene`) | Explore hero with bundled portrait clips | 1 | rebuilt, not ported |
| Destination index and region pages (`/destinations`, `[slug]`) | Explore regions + Destination screen | 1 | |
| Region SVG maps (`RegionMap`, `DestinationMapSection`) | Map modal, own hit-testing | 1 | spike decides SVG vs Skia |
| Package cards, package detail (`PackagesRow`, `packages/[packageSlug]`) | Package list + detail | 1 | |
| Request quote for a package (`PackageRequestModal`) | Request quote sheet | 1 | needs auth |
| Planner: mode, where, options, quote (`PlannerWizard`, `WorldMapPicker`, `ExplorePicker`, `DecisionMatrix`, `QuotationView`) | 4-step planner + quote | 1 | engine shared |
| Package browse rail inside planner (`PackageBrowseRail`) | "Start from a package" | 1 | |
| Sign in, register, forgot/reset (`AuthModal`, `reset-password`) | Auth sheet + universal link for reset | 1 | bearer tokens |
| Google sign-in | Google (+ Apple) | 1 | |
| X sign-in, Facebook | not in app | n/a | Facebook already disabled; X on request |
| Send for approval (`SendForApprovalModal`) | "Send to Retro" | 1 | |
| My requests list and detail (`my-requests`) | Trips tab | 1 | |
| Quote offer: accept / changes / decline / cancel (`QuoteOffer`) | Quote offer screen | 1 | |
| Pay with Razorpay | hosted pay page in secure browser | 1 | no native SDK |
| Contact form (`ContactForm`) | Talk to us: chat + WhatsApp + call | 1 | |
| Policies: privacy, terms, refund, cancellation, payment, data deletion (`LegalPage`) | Legal screens (DOM components or native text) | 1 | |
| Footer contact info | More tab | 1 | |
| Google Analytics / Ads (GTM) | Analytics events mapped 1:1 (`purchase`, `ads_conversion_request_quote`) | 2 | Measurement Protocol via Worker keeps native SDKs out |
| Admin: requests, quote editor, price split (`/admin`) | **not in app**; web only | n/a | staff get push alerts (Phase 2) |
| Live rates, enquiry storage, quote snapshots | unchanged backend | 0 | |
| Push notifications | new | 2 | |
| Offline browse | new | 1 | bundled snapshot |
| Wishlist / saved trips | new, optional | 3 | |
| Hindi / Bengali | new, optional | 3 | |

## Phases (calendar estimates are **[Guessing]**; re-estimate after the spike)

| Phase | Scope | Exit criteria | Rough size |
|---|---|---|---|
| **0: Foundation** | Spike (doc 02), backend changes (doc 01), `packages/*` extraction with web green, Expo skeleton, design tokens, CI | Engine parity test green; web suite unchanged; app boots on a phone against local Worker | 1 to 2 weeks |
| **1: MVP (private beta)** | Explore, destinations, packages, planner and quote, map modal, auth, request quote, trips, quote offer, payment (test mode), chat + WhatsApp, policies, delete account | Doc 03 acceptance criteria; Maestro suite green; TestFlight + Play internal | 5 to 7 weeks |
| **2: Public launch** | Push notifications, analytics, Sentry, store assets, review notes, closed test, phased rollout, WhatsApp Cloud API notices (optional) | Approved on both stores; crash-free sessions ≥ 99% [target] | 2 to 4 weeks, plus store waiting time |
| **3: Growth** | Saved trips, languages, tablet layout, light theme, live-rate badges, referral | driven by data | ongoing |

## Risks

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| Engine slow or memory-heavy on low-end Android | medium | high | Spike first; lazy per-place bundles; debounce; worker thread fallback |
| Map jank on dense regions | medium | medium | Skia fallback; clustering; list-first UX removes dependency |
| Store review delay (Apple org enrolment, Google 12-tester rule) | high | schedule | start accounts immediately |
| Payment return flow loses state | low | high | server is source of truth via existing webhook; app polls |
| Catalogue update strands old apps | medium | medium | manifest versioning + `minVersion` |
| Scope creep from "every web feature" | high | schedule | parity matrix is the contract; admin excluded |
| WhatsApp number disrupted by API registration | medium | high | Phase 1 uses click-to-chat only; plan coexistence before Phase 2 |

## Decision log
- ADR-1 Expo/React Native over webview, Flutter, native.
- ADR-2 Engine on device, not on server.
- ADR-3 Bearer tokens for mobile; cookies unchanged for web.
- ADR-4 Razorpay via hosted page, no native SDK.
- ADR-5 Scripted chat in-house; WhatsApp click-to-chat first.
- ADR-6 Guest-first; auth deferred to the first value-creating action.
- ADR-7 Admin stays on the web.
