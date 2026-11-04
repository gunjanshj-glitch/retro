# Retro Holidays mobile app: plan

Status: **plan final; implementation in progress.** The backend work is done in code (the latest Worker changes are not deployed yet); the Expo app has its foundation and a first slice of screens. See the status table below, which is updated with every change.

Confidence tags used throughout: **[Certain]** verified in this repo, by a test I ran, or from an official source; **[Likely]** strong inference; **[Guessing]** assumption to confirm.

| Doc | What it answers |
|---|---|
| [01-backend-reuse.md](01-backend-reuse.md) | What the Cloudflare backend already gives the app, what blocks it (B1 to B10), and the exact changes |
| [02-architecture.md](02-architecture.md) | Framework decision, repo and folder structure, what is shared with the web |
| [03-ux-design.md](03-ux-design.md) | Where the web UX breaks on a phone, and the screen-by-screen design |
| [04-chat-and-whatsapp.md](04-chat-and-whatsapp.md) | The questionnaire chat, the WhatsApp strategy, coexistence, costs |
| [05-testing-and-release.md](05-testing-and-release.md) | Local testing, test layers, payment states, compliance, store release, operations |
| [06-roadmap-and-parity.md](06-roadmap-and-parity.md) | Every web feature mapped to the app, phases, risks, decision log |
| [07-staff-and-negotiation.md](07-staff-and-negotiation.md) | **New.** Staff mode and the quote back-and-forth until payment |
| [08-accounts-and-dev-track.md](08-accounts-and-dev-track.md) | **New.** Building and testing before the Apple/Google accounts exist, and Gate A |
| [09-gap-review.md](09-gap-review.md) | **New.** The audit: every gap found, evidence, severity, fix, owner doc |
| [mockup/](mockup/index.html) | Clickable phone mockup (traveller and staff) |

## Implementation status

Updated: 2026-11-04. **Done** = built, type-checked and covered by tests where logic exists. **Not verified on a device** is called out, because nothing here has run on a phone yet.

| Area | Item | Status | Notes |
|---|---|---|---|
| Backend | B1 bearer tokens, hashed sessions, single session reader | Done | |
| Backend | B7 idempotency keys, B8 draft optimistic lock | Done | |
| Backend | B5 `/app-config` version gate | Done | |
| Backend | B10 free-form messages, staff leads list | Done | |
| Backend | B2 mobile sign-in return (PKCE), Apple sign-in | Done | Apple tested against a generated key, not Apple |
| Backend | B3 delete account | Done | |
| Backend | B4 hosted pay page | Done | Needs one Razorpay test-mode payment to confirm the page's CSP |
| Backend | B6 push (registry, coalescing, receipts, cron) | Done | Tested against a mocked Expo API |
| Backend | Audit fixes, router, `/api/v1`, error codes, rate limits | Done | |
| Backend | Email via Resend (MailChannels removed) | Done, deployed key | Worker redeploy pending |
| Backend | `/auth/me` returns `isStaff` | Done | Not deployed yet |
| Backend | O1 catalogue manifest, O2 image variants | Pending | Optimisations |
| Backend | O4 contracts package (zod request/response schemas) | Pending | Types are hand-written in `api-client` for now |
| Backend | O5 Cloudflare rate rules, O6 cache policy, O7 Sentry | Pending | Dashboard/ops work |
| Backend | O8 `.well-known` files (universal links) | Pending | Needs store accounts (Gate A) |
| Packages | `@retro/core` (engine, schema, pricing, workflow) | Done | |
| Packages | `@retro/api-client` (bearer transport, idempotency) | Done | 8 tests |
| Packages | `@retro/chat-flow` (flow + runner + lead builder) | Done | 16 tests; web chat UI not built |
| Packages | `@retro/contracts` | Pending | See O4 |
| App | Expo SDK 58 skeleton, Metro monorepo config, theme tokens, UI kit | Done | iOS bundle builds |
| App | Update/maintenance gate | Done | |
| App | Auth: email/password, create account, forgot, Google, secure token | Done | Not verified on a device |
| App | Explore: package list, search | Done | Reads the live site's package data; bundled offline snapshot Pending |
| App | Package detail and "ask for a quote" request | Done | |
| App | My trips: quotation requests and package requests | Done | |
| App | Trip screen: quote, optional extras, accept, ask for changes, decline, withdraw, messages, pay | Done | Quote requests are now created by the planner |
| App | Talk to us: scripted chat, lead, WhatsApp hand-off | Done | |
| App | More: contact, policies, sign out, delete account | Done | Policies open the website |
| App | Staff: queue, request detail, reply, private note, start review, leads | Done (S1, S2 reply) | Quote editor and "send quote" are S3, Pending |
| App | Push registration | Done in code | Needs an Expo project id and a real phone |
| App | Planner: where, when and who, style, live quote, send to Retro | Done in code | 4 steps with a live price bar; draft survives an app kill. Not run on a device. Live hotel rates (second pricing pass) and the explore questionnaire are Pending |
| App | Map modal (pan, zoom, pins) | Done in code | Skia on one canvas, own hit-testing, 10 regions as chips. Not run on a device; the world-map zoom is replaced by region chips |
| App | Launch data check: revision, download only what changed, waiting screen with a game, offline fallback | Done in code | Needs the website redeployed so `/atlas/manifest.json` exists. Price policy now comes from the backend too |
| Both | Pricing fixes from the agency's Vietnam and Rajasthan test trips | Done in code, needs redeploy | One engine prices web and phone. India: one all-in vehicle per day (Sedan 4,500 / SUV 5,500 / Tempo 7,500 / Bus 9,000, long drives 2-3x) and meals at INR 650 a head at 3 Star. Vietnam: hotel 0.5x, visa 1.2x, air 1.9x (fitted to ONE retrieved itinerary), paid attractions now priced, Danang airport and island legs fixed. Nights slider no longer resets on unrelated clicks. 4/5 Star meal prices and the Vietnam air factor are agency-to-confirm |
| Both | Location price checks against the agency's published packages | Done in code, needs redeploy | Country factors fitted to the 77 published packages (median now -3%, none above +27%), bounded 0.4-1.5x; India and Vietnam left on the agency's own line-by-line figures. Sightseeing: places with priced attractions but no day-plan content now get one cluster per attraction, blank rate cards (Hong Kong, Philippines) are priced at the country's typical paid attraction, a half-day cluster carries at most two tickets. Andaman and other island hops go by ferry, not a Rs 5,750 flight. A published price over 3x the quote (Maharashtra Rs 5,00,000) is ignored as a data error. Open: India brochure prices for Gujarat/Andaman sit below the agency's own hotel plus vehicle rates, and 4/5 Star India meals are still derived from the 3 Star figure |
| App | Destination screens, region browsing | Pending | |
| App | Staff S3: full quote editor, send revision | Pending | Largest staff item |
| App | Biometric re-lock and screenshot block for staff | Pending | |
| App | Sign in with Apple button | Pending | Backend ready; needs the Apple account |
| App | Push tap routing (open the right trip) | Pending | |
| App | Analytics events (Phase 2) | Pending | |
| App | Policies as native screens | Pending | Websites links for now |
| Quality | Device spike (engine speed on Hermes, map fps, `@expo/ui` in Expo Go) | **Pending** | Needs your iPhone |
| Quality | Golden-fixture engine parity (Node vs Hermes) | Pending | |
| Quality | Maestro end-to-end flows, app unit tests | Pending | No app tests exist yet |
| Quality | CI for the app | Pending | |
| Release | Gate A: Apple and Google accounts, signing, TestFlight, Play internal | Pending | Needs accounts |
| Release | EAS project, `eas.json` build profiles | Pending | |
| Release | Store assets, review notes, privacy declarations | Pending | |
| Ops | Deploy Worker with latest backend changes | Pending | Run `npx wrangler deploy` in `workers/api` |

## Your answers, and what they changed

| Question | Your answer | Effect on the plan |
|---|---|---|
| Apple / Google accounts | none yet; build and test first, integrate after | doc 08: everything is buildable on Expo Go; account steps are Gate A. Enrolment is still the launch long pole |
| Is 6290855027 on the WhatsApp Business app? | yes | doc 04: use **coexistence** for any future API; never register it on the API the ordinary way |
| Admin in the app? | **yes, all features; the quote review back-and-forth until payment is important** | **doc 07, new**: staff mode, conversation screen, messages, push moved into Phase 1. Reverses the earlier "web only" decision |
| Languages | English only | strings kept in one file; no i18n library |
| iPad (unanswered) | defaulted | iPhone-only for v1 |

## The decisions, in one page

1. **Expo (React Native) with TypeScript, not a webview and not Flutter.** Web DOM components cannot run natively, so UI is rewritten; **logic is reused** (pricing engine, catalogue schema, quote maths, validation, contracts). Wrapping the website would ship the experience that fails on a phone and risks guideline 4.2.
2. **Same Cloudflare backend, extended, not forked.** It already runs the entire quote negotiation (11 statuses, numbered revisions, compare-and-swap, server-computed accepted total) [Certain]. The app is a new client for it. Ten additive changes are needed (doc 01), two of them fixing defects I reproduced.
3. **The pricing engine runs on the phone**, as in the browser, guarded by a golden-fixture parity test.
4. **Guest-first.** Browse, plan and get a live price without an account. Sign-in appears at "Request quote" and "My trips"; the draft survives it.
5. **The map is secondary** on a phone: its own full-screen view with its own finger-sized hit-testing; search and cards are the main way to choose places.
6. **Staff mode in the same app**, role-gated and server-enforced, delivered in stages; staff use email and password, not social login.
7. **The negotiation is a conversation screen**: thread, questions that don't change the quote's status, a "what changed since v1" card, one primary action per state, push at every hand-over.
8. **Scripted chat built in-house**, no AI, shared by web and app; ends in a stored lead, a staff push, and a prefilled WhatsApp message.
9. **WhatsApp: free click-to-chat now**; Cloud API later in coexistence mode, outbound notices only.
10. **Build with no store accounts**, integrate at Gate A; Sign in with Apple is the only auth piece blocked, and is only needed if Google is offered.
11. **Skills installed:** 13 official Expo skills (vetted, MIT) in `.claude/skills/`.

## What I found when auditing this plan

The audit is in [09-gap-review.md](09-gap-review.md). The ones that would have hurt:

- **Reproduced:** a retried "send quote" creates a duplicate revision and a second email. A stale draft overwrites a colleague's. Both are minor on a desktop and routine on a phone.
- **Staff would have been locked out on mobile:** session reading exists in two places; fixing only one would make every staff call return 404.
- **The redirect design had a hole:** one-time login codes on a custom URL scheme can be stolen by another app unless bound to a verifier; and Expo Go's `exp://` redirect needs a dev-only allow-list.
- **Push was in the wrong phase.** A two-sided negotiation without push is two people waiting to notice.
- **Business gaps the code cannot solve:** no refund/cancel path after payment, no balance due date.

## Already done in this change

- Website WhatsApp links point to **+91 62908 55027**; the phone line stays +91 98047 86498 (`packages/core/contact.ts`).
- `.claude/skills/` holds the vetted Expo skills.
- Margin allocation fix (pro rata) from the previous request.

## Not done, on purpose

- Unverified until the spike: engine speed on Hermes, map frame rate, `@expo/ui` in Expo Go, whether the web timeline renders the new `message` event type.

## Decisions closed

| Topic | Decision |
|---|---|
| Staff access | Unchanged. Anyone who can sign in to the existing web admin sees all requests in the app; no separate staff list |
| Refunds, cancellations after payment | Out of v1: WhatsApp hand-off with the booking reference |
| Balance due dates | Out of v1: manual follow-up |
| iPad, languages | iPhone-only, English only |
| Company status and enrolment | Not needed to start. Decide at milestone M3 (doc 08); a registered company makes the Apple/Google accounts faster and removes Google's 12-testers-for-14-days rule |

## Where implementation starts

Phase 0 (doc 06): the 1 to 2 day device spike, then the three-commit `readSession()` refactor on the preview Worker, then backend changes B1 to B10, then `packages/*` extraction, the Expo skeleton and the seed script.
