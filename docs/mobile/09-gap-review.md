# 09. Gap review

How the audit was done: I re-read all seven plan documents against the actual Worker code (`index.ts`, `auth.ts`, `admin.ts`, `requests.ts`, `request-admin.ts`, `request-core.ts`, `payments.ts`, `lib/quote-workflow.ts`, migrations 0001 to 0006, both wrangler configs) and the vendored Expo skills, then checked the platform rules that decide store approval. Two suspected defects were **reproduced with throwaway tests** (deleted afterwards; the tree is clean).

Severity: **S1** breaks the product or loses money/data, **S2** breaks a promised feature or a store approval, **S3** quality or schedule risk. Status: all rows are fixed **in the plan**; none is fixed in code yet.

## Reproduced by running code

| Probe | Result |
|---|---|
| Send the same admin quote twice | Both return `200`; revisions are `v1 superseded` and `v2 sent`; traveller emailed again |
| Save a draft from a stale copy | Second save replaces the first, no warning |

## Register

| ID | Sev | Gap | Evidence | Fix | Doc |
|---|---|---|---|---|---|
| G1 | S1 | Retried sends duplicate revisions/emails; creates have no idempotency; rate limit can block a legitimate retry | reproduced; `handleCreateRequest` rate limit | `Idempotency-Key` on every create/send, KV-backed replay | 01 B7, 07 N1 |
| G2 | S1 | Staff drafts overwrite silently | reproduced | `baseUpdatedAt` precondition, 409 with latest | 01 B8, 07 N2 |
| G3 | S1 | Session read in two places (`getSessionUser`, `getAdminUser`); bearer on one means staff calls 404 on mobile | `auth.ts:85`, `admin.ts:26` | single `readSession()`, source-grep test | 01 B1 |
| G4 | S1 | Session tokens stored in plaintext; naive hashing migration would log everyone out mid-flow | `INSERT INTO session (id …)` | hash with dual lookup for 30 days | 01 B1 |
| G5 | S1 | Mobile login code on a custom scheme can be stolen by another app | RFC 8252 guidance | bind code to a PKCE verifier | 01 B2 |
| G6 | S2 | Expo Go redirects use `exp://`, not `retro://`; allowing it in production would be an open redirect | Expo behaviour | dev/preview-only allow-list variable | 01 B2, 08 |
| G7 | S1 | Payment success shown from a redirect could be wrong; app killed mid-payment | webhook is the source of truth | "confirming" state polling `paid_inr`, resume on launch | 01 B4, 05 |
| G8 | S2 | Hosted pay page put a token in a URL | design | HMAC single-purpose 10-minute token, not the session | 01 B4 |
| G9 | S2 | Negotiation had no push; two people waiting to notice | doc 01 had push in Phase 2 | push moved to Phase 1, generic payload | 01 B6, 06 |
| G10 | S2 | No way to ask a question without changing state | `handleRequestChanges`, `EVENT_TYPES` | `message` events, both directions | 07 N3 |
| G11 | S2 | Nothing shows what changed between versions | stored `public_view` per revision | client diff card | 07 N5, 03 |
| G12 | S2 | Re-opening an accepted quote silently clears acceptance | `handleAdminSendQuote` | blocking staff confirm; plain traveller push | 07 N6 |
| G13 | S2 | Expiry only on read; list path can write up to 300 rows; no reminders | `refreshExpiry`; no `[triggers]` | Cron Trigger every 15 min | 01 B9, 07 N7 |
| G14 | S2 | No staff list of chat/contact leads | route table has no `/admin/enquiries` | add endpoint, Leads screen | 07, 04 |
| G15 | S2 | Admin out of scope contradicted your answer | your answer 3 | staff mode, stages S1 to S3 | 07 |
| G16 | S2 | Doc 01 said admin is "Google-only"; code also allows a verified password | `getAdminUser` | staff use email + password; no social login needed | 01, 07 |
| G17 | S2 | Staff phone is a high-value target (PII, can send quotes) | design | 7-day sessions, biometric re-lock, screenshot block, `logout-all`, runbook | 07 |
| G18 | S2 | Push text on lock screen and via three vendors | design | generic text + id only | 01 B6, 07 N10 |
| G19 | S2 | Plan assumed store accounts early (Apple sign-in, universal links, push) | your answer 1 | account-agnostic adapters, Gate A | 08 |
| G20 | S2 | Android remote push does not work in Expo Go since SDK 53 | vendored skill | dev build + Firebase, still no Play account | 08, 05 |
| G21 | S2 | Sign in with Apple untestable without the account | Apple | feature flag; ship email-only if late (4.8 then not triggered) | 01 B2, 08 |
| G22 | S3 | Enrolment lead time is the launch long pole | Apple, Google | start at M3; one signed iPhone build at M3; ask about company status | 08 |
| G23 | S3 | Google's 12-testers-for-14-days rule not in the schedule | secondary sources | scheduled; organisation account exempt | 05, 08 |
| G24 | S2 | WhatsApp number is on the Business app; ordinary API registration can disconnect it | your answer 2 | coexistence mode only; 24-hour window explains why Phase 1 is free | 04 |
| G25 | S3 | Chat leads: spam, duplicates, retention, consent | design | rate limits, Turnstile on web, dedupe, retention, consent text, staff push coalescing | 04 |
| G26 | S3 | Catalogue/engine version skew between phone, web, staff | static JSON, client engine | version stamp on every quote; staff warning | 01 O10 |
| G27 | S3 | Client-computed totals can be forged | `quotation` posted by client | staff review today; server-side engine check later | 01 O11 |
| G28 | S2 | Paid bookings have no cancel/refund transition; no balance due date | `TRANSITIONS`; `payment` table | **decision needed**; WhatsApp handoff with booking ref meanwhile | 07 N8/N9 |
| G29 | S3 | Offline behaviour for writes was unspecified | design | online-only except queued chat leads with idempotency key | 02 |
| G30 | S3 | Local test pitfalls (firewall, cleartext, LAN isolation, HTTPS return) would burn days | experience | documented, plus seed script and scripted staff actor | 05 |
| G31 | S3 | No way to test a two-sided flow with one phone | design | `mobile:act` script plays the other side | 05 |
| G32 | S2 | Compliance items were scattered | store policies | single checklist: privacy text, App Privacy/Data safety, manifest, export flag, deletion, Android levels, DPDP | 05 |
| G33 | S3 | No post-launch operations plan | design | alerts, one-page runbook, release health gates | 05 |
| G34 | S3 | Migration safety | additive only | export first; restore window; additive rollback | 01 |
| G35 | S3 | Refactor of session code could regress the live website | production | three separate commits; web suite green after each; cookie behaviour byte-identical | 01 |
| G36 | S3 | iPad/tablet scope unanswered | open question | iPhone-only v1 | 02 |
| G37 | S3 | Staff editor on a phone is the biggest single effort, estimate unstated | web editor is 1,053 lines plus planner | S1/S2/S3 stages; schedule re-estimated | 07, 06 |
| G38 | S3 | Dark-only theme with no system light option | design | deliberate for v1; light theme Phase 3 | 03 |

## Still unverified (no amount of reading settles these)

| Item | Why | When settled |
|---|---|---|
| Pricing engine speed and memory on Hermes, low-end Android | needs a device | spike, before any app code |
| Map frame rate with 54 pins and pinch/pan | needs a device | spike |
| `@expo/ui` components in Expo Go on the chosen SDK | needs a device | spike |
| Web timeline renders an unknown event type | one-line check | spike |
| WhatsApp Cloud API India rates; coexistence country/version rules | not on Meta pages I could fetch; vendor pages disagree | read Meta's rate card and coexistence page before Phase 2 |
| Google Play 12-tester rule details | Google's page not retrievable | read at Gate A |
| UPI app switching from the in-app browser on iOS | needs a real device and test mode | M3 |
| Calendar estimates in doc 06 | judgement | re-estimate after the spike |

## Decisions needed from you (they change scope, not just detail)

1. Is the business a registered company? (store account type, Play testing rule)
2. Refunds and cancellations after payment: leave outside the system, or model them?
3. Balance due dates and reminders for part-paid bookings?
4. Staff email list for `ADMIN_EMAILS`, and who may be added later?
5. When to start Apple/Google enrolment (recommended: at M3).
