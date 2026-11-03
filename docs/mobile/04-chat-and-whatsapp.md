# 04. Chat questionnaire and WhatsApp

Business WhatsApp: **+91 62908 55027** (`916290855027` for wa.me links). Phone line stays +91 98047 86498.

## Hard facts first

1. **A website cannot silently send a WhatsApp message to your business number.** `wa.me` links only open the customer's own WhatsApp with a prefilled draft; they must press send. Automatic sending needs the WhatsApp Cloud API. [Certain]
2. **There is no free embeddable WhatsApp chat window.** Embedding a real two-way chat in a site or app needs the Cloud API plus an inbox to answer from (a self-built admin inbox or a paid tool). [Certain: Meta provides the API, not a widget]
3. **Cloud API pricing (checked against Meta's pricing page):** messages *from* customers are free; replying inside the 24-hour window after their message is not charged as a template; each business number gets **1,000 free service messages per month**, charged beyond that **from 1 Oct 2026**; marketing, utility and authentication **templates are charged per delivered message**; utility messages inside an open window became charged on 1 Oct 2026. The page does not print India's per-message rates (they are in a downloadable rate card); third-party blogs quote figures from about ₹0.11 (utility) to about ₹0.86 (marketing) but disagree, so treat as **[Guessing]** until you read the rate card. Plus BSP fees and 18% GST if you use a provider.
4. A phone number is normally either on the **WhatsApp Business app** or on the **Cloud API**, not both, unless Meta's coexistence mode is used [Likely]. Registering it carelessly can knock your current WhatsApp Business app offline. Do not do this without a plan.

## Decision

| Phase | What | Cost | Effort |
|---|---|---|---|
| **1 (with the app)** | **Click-to-chat** floating button on web and "Talk to us" in the app. Prefilled message carries context (page, planned trip summary, quote reference). Every lead is **also stored** (D1 via `POST /enquiries`) and emailed to info@, so a missed WhatsApp never loses a lead | free | small |
| **2 (optional)** | Cloud API for **outbound utility notices only** ("Your quote RH-1234 is ready" with a link). Used in addition to push and email, and to alert the owner's own WhatsApp about new leads | per-message, see fact 3 | medium: Meta business verification, display-name approval, template approval, number migration plan |
| **3 (only if volume justifies)** | Shared inbox for two-way WhatsApp (e.g. self-hosted Chatwoot connected to the Cloud API) | server hosting + ops | large |

Why this order: Phase 1 captures nearly all the value (people already use WhatsApp with Indian travel agents) at zero running cost and zero risk to your existing number. Phase 2 gives automation where it actually pays: telling a customer their quote is ready, which today relies on email that Indians read less than WhatsApp [Likely]. Phase 3 is a staffing decision, not a software one.

## The chat questionnaire

You asked for a minimal scripted chat (no AI), ending in the visitor's contact so the business can follow up. Open-source options considered:

| Option | Licence | Runs on Cloudflare free tier? | Fit |
|---|---|---|---|
| **Typebot** (visual bot builder) | source-available (Functional Source License; sources disagree, check LICENSE) | No: needs Postgres + several services; one host estimates US$10 to 20 a month [from a vendor listing] | Great builder, wrong infrastructure; no native WhatsApp |
| **Chatwoot** (support inbox + widget) | MIT core [Likely] | No: Rails + Postgres + Redis | Right for Phase 3, overkill now |
| **react-native-gifted-chat** | MIT [Likely] | n/a (UI library) | Optional UI base, but a scripted flow needs only bubbles and chips |
| **Own flow runner** (recommended) | ours | **Yes**: static JSON + existing Worker | Smallest total effort and risk |

**Recommendation: build it.** About 250 lines: a JSON flow plus a pure runner in `packages/chat-flow`, rendered by a small React component on web and a small React Native component in the app. No server, no new vendor, same lead pipeline as the contact form. I did not find a repository that is *less* work than this once you add hosting and lead routing.

### Flow (editable JSON, same on web and app)

```
1  Hi, I'm the Retro Holidays assistant. Where would you like to go?   [India · Europe · South-East Asia · Middle East · Not sure yet]
2  When are you thinking of travelling?                                [Next 3 months · 3-6 months · Later · Just exploring]   (+ month picker)
3  Who's travelling?                                                    [Couple · Family · Friends · Solo · Pilgrimage]
4  How many days?                                                       [3-5 · 6-8 · 9-12 · 13+]
5  Rough budget per person?                                             [Under ₹50k · ₹50k-1.5L · ₹1.5L-3L · ₹3L+ · Not sure]
6  What's your name?                                                    [text]
7  Your mobile number? (Retro will contact you; we never share it)     [phone, +91 10-digit validation]
8  Summary card → [Send on WhatsApp] [Call me instead] [Email me]
```

Rules: any step skippable except name and one contact; "Plan it myself" jumps to the planner pre-filled from answers; answers are saved as you go so closing the sheet does not lose them.

### What happens on submit
1. `POST /enquiries {source: "app-chat" | "web-chat", name, phone, email?, destination, travelWindow, travellers, notes: "<budget, days, answers>"}` (existing endpoint; honeypot and size limits already exist; add `source` values and a phone-format check).
2. Worker emails the lead to info@ using the existing mail helper (small addition: `enquiries.ts` does not email today [Certain: it only inserts]). Phase 2: also WhatsApp/push to the owner.
3. App/web opens `https://wa.me/916290855027?text=<summary>` if the visitor chose WhatsApp. If they chose "Call me", no WhatsApp is needed, and the lead is already stored.

Spam and privacy: honeypot field, per-IP and per-device rate limit, consent line ("Retro will contact you on this number"), listed in the privacy policy and the Play Data Safety / App Privacy declarations.

## Website changes (to ship with Phase 1)
- Floating "Talk to us" button (WhatsApp / chat / call) site-wide, replacing ad hoc links. `lib/contact.ts` is the single source of numbers (done).
- Contact form keeps working; it already stores the enquiry before the WhatsApp handoff.
- Link text and `aria-label`s name the number so it can be verified.
