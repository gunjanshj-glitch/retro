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
| Admin: requests list and detail (`AdminTripRequests`, `AdminRequestDetail`) | Staff queue + request detail | 1 (S1) | doc 07 |
| Admin: quote editor, pricing panel, price split with line toggles (`AdminQuoteEditor`, `PricingPanel`, `PriceSplitPanel`) | Staff quote editor | 1 (S2 send, S3 full editor) | S3 is the largest item |
| Admin: package requests (`AdminRequests`) | Staff Leads tab | 1 (S1) | |
| Admin: dashboard (`AdminDashboard`) | Queue counts | 1 (S1) | |
| Quote conversation: questions, change chips, version diff | Trip screen thread | 1 | new in app, also worth adding to the web later |
| Chat/contact leads for staff | Staff Leads + push | 1 | needs `GET /admin/enquiries` |
| Live rates, enquiry storage, quote snapshots | unchanged backend | 0 | |
| Push notifications (traveller and staff) | new | **1** (moved up: the negotiation needs it) | iOS in Expo Go; Android needs a dev build |
| Offline browse | new | 1 | bundled snapshot |
| Wishlist / saved trips | new, optional | 3 | |
| Hindi / Bengali | new, optional | 3 | |

## Phases (calendar estimates are **[Guessing]**; re-estimate after the spike)

| Phase | Scope | Exit criteria | Rough size |
|---|---|---|---|
| **0: Foundation** (M0) | Spike (doc 02), backend changes B1 to B10 (doc 01) on preview, `packages/*` extraction with web green, Expo skeleton, design tokens, seed script, CI | Engine parity test green; web suite unchanged; app boots on a phone against local Worker | 2 to 3 weeks |
| **1: MVP** (M1 to M5) | Guest browse, planner and quote, map modal, auth, request quote, trips and the quote conversation, payment (test mode), chat + WhatsApp, push, **staff S1 + S2 then S3**, policies, delete account | Doc 03 and doc 07 acceptance criteria; Maestro suite green on both platforms | 9 to 12 weeks (was 5 to 7 before staff mode and push moved in) |
| **Gate A: accounts** (doc 08) | Apple + Google enrolment and configuration, TestFlight + Play internal, privacy declarations, closed test if a personal Play account | Signed builds on real devices; links and push verified | 1 to 2 weeks of work plus waiting |
| **2: Public launch** | Store assets, review notes, phased rollout, optional WhatsApp Cloud API notices | Approved on both stores; crash-free sessions ≥ 99% [target] | 1 to 2 weeks, plus store waiting time |
| **3: Growth** | Saved trips, languages, tablet layout, light theme, live-rate badges, referral | driven by data | ongoing |

## Risks

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| Engine slow or memory-heavy on low-end Android | medium | high | Spike first; lazy per-place bundles; debounce; worker thread fallback |
| Map jank on dense regions | medium | medium | Skia fallback; clustering; list-first UX removes dependency |
| Store review delay (Apple org enrolment, Google 12-tester rule) | high | schedule | start accounts immediately |
| Payment return flow loses state | low | high | server is source of truth via existing webhook; app polls |
| Catalogue update strands old apps | medium | medium | manifest versioning + `minVersion` |
| Scope creep from "every web feature" | high | schedule | parity matrix is the contract; staff mode delivered in stages S1/S2/S3 |
| Staff quote editor on a phone is a poor authoring tool | medium | adoption | S1/S2 make the phone good at *responding*; web editor stays for long rewrites; judge S3 on staff feedback |
| Retried writes duplicate revisions, requests or leads (reproduced) | high without fix | money and trust | `Idempotency-Key` everywhere, failure-injection test |
| Admin calls silently fail on mobile because session reading lives in two places | high without fix | staff mode dead | single `readSession()`, source-grep test |
| Deferring store accounts moves the schedule risk to the end (doc 08) | high | launch date | start enrolment at M3; one signed iPhone build at M3 |
| Apple objects to staff features in the public app | low to medium | resubmission | review notes; fallback internal-only variant |
| Paid-booking cancellation/refund not modelled | medium | customer service | decided: out of v1; WhatsApp handoff |
| WhatsApp number disrupted by API registration | medium | high | Phase 1 uses click-to-chat only; plan coexistence before Phase 2 |

## Decision log
- ADR-1 Expo/React Native over webview, Flutter, native.
- ADR-2 Engine on device, not on server.
- ADR-3 Bearer tokens for mobile; cookies unchanged for web.
- ADR-4 Razorpay via hosted page, no native SDK.
- ADR-5 Scripted chat in-house; WhatsApp click-to-chat first.
- ADR-6 Guest-first; auth deferred to the first value-creating action.
- ADR-7 ~~Admin stays on the web.~~ **Superseded by ADR-8.**
- ADR-8 Staff mode is in the app (your answer: all features, negotiation matters). One binary, role-gated and server-enforced; staff sign in with a verified password, not social login.
- ADR-9 Develop and test with no store accounts; account-specific features sit behind provider adapters and flags (doc 08).
- ADR-10 Every create/send is idempotent; drafts are optimistic-locked (doc 01, B7/B8).
- ADR-11 Push moved into Phase 1; payload is generic by rule.
- ADR-12 iPhone-only for v1; English only (your answer).
