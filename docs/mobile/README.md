# Retro Holidays mobile app: plan

Status: **proposal, awaiting review.** No mobile code exists yet. The only code changed alongside this plan is the website's WhatsApp number (see "Already done").

Confidence tags used throughout: **[Certain]** verified in this repo or an official source, **[Likely]** strong inference, **[Guessing]** assumption to confirm.

| Doc | What it answers |
|---|---|
| [01-backend-reuse.md](01-backend-reuse.md) | What the Cloudflare backend already gives the app, what blocks it, and the exact changes needed |
| [02-architecture.md](02-architecture.md) | Framework decision, repo and folder structure, what is shared with the web |
| [03-ux-design.md](03-ux-design.md) | Where the web UX breaks on a phone, and the screen-by-screen design that replaces it |
| [04-chat-and-whatsapp.md](04-chat-and-whatsapp.md) | The questionnaire chat, the WhatsApp strategy, costs, limits |
| [05-testing-and-release.md](05-testing-and-release.md) | Local testing, test layers, store release, review risks, CI |
| [06-roadmap-and-parity.md](06-roadmap-and-parity.md) | Every web feature mapped to the app, phases, open questions |
| [mockup/](mockup/index.html) | Clickable phone mockup (also published as an artifact) |

## The decisions, in one page

1. **Expo (React Native) with TypeScript, not a webview wrapper and not Flutter.**
   You asked to reuse the front end as much as possible. The honest answer: **web DOM components cannot run natively, so UI code is not reusable. Logic is.** The pricing engine, catalogue schema, quote maths, validation and API contracts are plain TypeScript and move over unchanged (the large majority of the non-visual code). Wrapping the website (Capacitor) would reuse the UI but ship the exact experience that the next section calls unusable on a phone, and risks App Store rejection under guideline 4.2 (apps that are a repackaged website) [Likely]. Flutter would reuse nothing.
2. **Same Cloudflare backend, extended, not forked.** The Worker already has every business endpoint the app needs. It lacks six mobile-specific things (bearer-token auth, mobile OAuth return, Sign in with Apple, account deletion, push registry, app-config/versioning). All additive and backward compatible. Details in doc 01.
3. **The pricing engine runs on the phone**, as it does in the browser. Re-pricing stays instant and offline-capable, and no new server cost appears. Guarded by a golden-fixture parity test (web vs device must produce identical totals).
4. **Guest-first.** Browse destinations, packages, the map and the live-priced planner without an account. Sign-in appears only at "Request quote" and "My trips", and the draft survives the sign-in.
5. **The map is a secondary tool on a phone.** Search and cards are the primary way to choose places. The SVG map moves to its own full-screen view with its own hit-testing. Rationale in doc 03.
6. **Chat: a built-in scripted questionnaire, not a third-party bot platform.** No open-source chat product runs on Cloudflare's free tier without adding a database server. A 250-line flow runner, shared by web and app, ends in lead capture plus a prefilled WhatsApp message.
7. **WhatsApp: free click-to-chat now, Cloud API later and only for outbound notices.** There is no free embeddable WhatsApp chat window for a website. Details and cost in doc 04.
8. **Skills installed:** the official Expo skills (13 of 23, MIT, vetted) are now in `.claude/skills/` so implementation follows Expo's current conventions rather than my training data.

## Already done in this change

- Website WhatsApp links now point to your business number **+91 62908 55027** (they pointed to 98047 86498, which stays as the phone line). One module, `lib/contact.ts`, now holds both numbers so the app reuses it.
- `.claude/skills/` holds the vetted Expo skills, with provenance in `.claude/skills/README.md`.

## Not done, on purpose

- **No backend changes yet.** You asked for the backend to be optimised, and doc 01 specifies each change precisely. I held back because they touch production sign-in, and the app does not exist to need them yet. The first implementation phase starts with them.

## Questions that change the plan

1. Do you already have an **Apple Developer** account (US$99/yr) and a **Google Play** account (US$25 once)? Apple takes days to weeks for an organisation (needs a D-U-N-S number) [Likely].
2. Is +91 62908 55027 **currently registered on the WhatsApp Business app** on a phone? That decides whether the Cloud API phase needs the "coexistence" mode.
3. Should **admin** (reviewing and sending quotes) be in the app? Recommended: no for v1. It is a desktop job; the app gets a push alert instead.
4. **Languages:** English only at launch, or Hindi and Bengali too? (Adds roughly 1 week per language for UI strings [Guessing].)
5. **iPad:** iPhone-first with a centred column on iPad is the plan. Say if you want a true tablet layout.
