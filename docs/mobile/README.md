# Retro Holidays mobile app: plan

Status: **proposal, awaiting your approval of the mockup and plan.** No mobile code exists yet. Implementation starts only after you approve.

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

- Website WhatsApp links point to **+91 62908 55027**; the phone line stays +91 98047 86498 (`lib/contact.ts`).
- `.claude/skills/` holds the vetted Expo skills.
- Margin allocation fix (pro rata) from the previous request.

## Not done, on purpose

- **No backend or app code.** The changes touch production sign-in and payments; they begin in Phase 0 after you approve.
- Unverified until the spike: engine speed on Hermes, map frame rate, `@expo/ui` in Expo Go, whether the web timeline renders the new `message` event type.

## Questions that remain

1. **Is Retro Holidays a registered company?** If yes, enrol both stores as an organisation (D-U-N-S): faster and it removes Google's 12-testers-for-14-days rule.
2. **A) Staff list:** which email addresses are staff today (`ADMIN_EMAILS`)? **B) Refunds and cancellations after payment:** the system has no path. Is it handled outside (Razorpay dashboard and WhatsApp) and should the app just hand off? **C) Balance due dates:** should part-paid bookings have a deadline and reminders?
3. When do you want to start Apple/Google enrolment? Recommended: at milestone M3 (doc 08).
4. iPad: iPhone-only is the default; say if you need a tablet layout.
