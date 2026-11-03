# 03. UX analysis and design

User experience is the first criterion. This doc finds where the existing web experience fails on a phone, then specifies the replacement. Skills used for craft: `expo-native-ui`, `expo-ui`, `expo-router`, `expo-animation`, `expo-design-system`.

## Who is on the phone [Likely]

Travellers researching on a phone, often on mobile data, often one-handed, often on a mid-range Android. They browse in short sessions, then decide with a partner. The first session is discovery, not purchase. The business outcome is a **quote request** (a lead), so the app must make "see a price for my trip" fast and "send it to Retro" frictionless.

## Where the web breaks on a phone

Measured from the repo, not guessed: `WorldMapPicker` 717 lines, `DecisionMatrix` 679, `QuotationView` 759, `PlannerWizard` 342 (all desktop-first); region maps 10 SVGs (224 KB total) with up to 54 pins (India) and a 36 KB marker file for Europe.

| # | Problem on a phone | Severity | Design response |
|---|---|---|---|
| 1 | **Map pins are 5 to 8 px targets.** A fingertip covers ~40 px. India has 54 pins, Europe hundreds. Mis-taps are guaranteed | critical | Do not make each pin a touch target. One gesture surface does **our own hit-test**: nearest pin within 22 pt (reusing the pure `pinHitRadius` logic). If several are within reach, show a "3 places here" bottom sheet to pick. Zoom grows spacing, as on the web |
| 2 | **Pan, pinch, page scroll and horizontal rails fight each other.** A map inside a scrolling page steals scroll, or scroll steals map drags | critical | The map lives in its **own full-screen route** (no parent scroll). Page rails use snap lists. Map gestures run on the UI thread (Gesture Handler + Reanimated) |
| 3 | **The map as the main way to choose** where to go assumes you know geography and have a precise pointer | high | Primary path is **search + cards + chips by region/theme**. Map is a secondary "Browse on map" mode, never required to finish the planner |
| 4 | **653 places, 77 packages**: a flat list is overwhelming | high | Entry by intent ("Beach", "Culture", "Family", "Honeymoon", "Pilgrimage") using existing `group-themes`, then region. Search is always one tap away, with recent and popular |
| 5 | **The decision matrix has dozens of controls** (traveller type, style, hotel star and zone, cabin, carrier, meal plan, food, pace, transport preference, visa, insurance…) | critical | Break into 4 short steps (Where, When, Who, Style), each 1 to 3 decisions. Everything else becomes **smart defaults** plus a single "Fine-tune" sheet. Defaults come from the traveller type, as `STYLE_FOR_TRAVELLER` already does |
| 6 | **Price changes are invisible** when controls are off screen | high | A **sticky price bar** ("from ₹1,82,299 for 2 · tap for breakdown") updates live as the engine recomputes, with a subtle count-up and a dimmed state while computing |
| 7 | **The quotation page is a long dense document** | high | Day-by-day **timeline** with collapsible days; activities removable by swipe; totals in a bottom sheet; the primary button ("Send to Retro for final quote") is pinned |
| 8 | **Hover states, tooltips, right-click** do not exist | medium | Replace with tap, long-press, and bottom sheets. No information may live only in a tooltip |
| 9 | **Forms**: keyboards cover fields, small text inputs, free text | medium | Native pickers for dates, steppers for counts, phone number keyboard, `autocomplete` hints, "Continue" above the keyboard. The planner stays free-text-free, as the web mandates |
| 10 | **Login wall** would kill discovery | critical | Guest-first. Auth is a bottom sheet, raised only by "Request quote", "My trips", "Pay". Pending action resumes after sign-in |
| 11 | **Hero video** costs data and battery | medium | Use the existing **portrait clips (80 to 300 KB each [Certain: file sizes])** bundled in the app for an instant first frame; fall back to the poster with a slow zoom on Low Power Mode, Data Saver, reduced-motion |
| 12 | **Payment** hands off to a bank/UPI app and returns | high | In-app secure browser; clear "Waiting for payment" state; deep-link return; status polled from the server so a lost return never loses a payment (the webhook already handles this) |
| 13 | **Variable networks (India)** | high | Skeleton screens, offline browse of bundled catalogue, retry buttons, optimistic UI, never a blank spinner |
| 14 | **Accessibility** | high | 44 pt / 48 dp targets, Dynamic Type, VoiceOver and TalkBack labels, gold-on-teal contrast checked (#fdbf00 on #071a1f is high contrast [Likely]; verify muted text), reduced motion honoured, map has a full list alternative |
| 15 | **Numbers**: ₹1,82,299 style grouping | low | `en-IN` formatting everywhere |

## Design language

Keep brand continuity with the site, translated to native, not skinned:

- **Colour**: deep teal-black `#071a1f` base, raised surface `#0e242a`, brand gold `#fdbf00` for the single primary action per screen, soft white text, muted `#9bb3b4`. Dark-first (brand and cinematic imagery). A light theme is a later option, not v1.
- **Type**: Instrument Serif for display moments (destination names, hero line, prices of note), Inter for interface. Same pairing as the website.
- **Shape and depth**: large imagery, generous radius (20 to 28), frosted translucent bars (`expo-blur`; liquid-glass effect on iOS 26 via `expo-glass-effect`), real SF Symbols on iOS, Material icons on Android.
- **Motion**: purposeful only: hero crossfade, shared-element transition card to detail, spring on sheets, count-up on price, haptic ticks on select. One orchestrated moment (the hero), everything else quiet. All gated by reduced-motion.

## Information architecture

Four tabs (a fifth, **Staff**, appears only for staff accounts, doc 07) plus a global "Talk to us" button.

```
Explore   ─ Hero → Themes → Featured packages → Regions → Why Retro → Footer
Plan      ─ Where → When → Who → Style → Quote  (guest OK)
Trips     ─ My requests (sign-in) → Request → Quote offer → Ask / Changes / Accept / Decline → Pay
Staff     ─ (staff only) Queue → Request → Quote editor → Send · Leads
More      ─ Account, contact, WhatsApp, policies, delete account, language
(global)  ─ Talk to us: Chat questionnaire · WhatsApp · Call
```

## Screen specifications

### 1. Launch and Explore (first screen)
Full-bleed portrait clip behind a gradient, region name crossfading every ~6 s (Egypt, Maldives, Paris, Agra, Norway…), headline in Instrument Serif, one gold button **Plan my trip**, one quiet **Browse packages**. Bottom tab bar over a blur. The page below scrolls: theme chips, "Popular right now" package cards (snap rail), region tiles, trust row (reviews from existing `google-reviews`), contact strip. No login, no onboarding carousel (carousels depress completion [Likely]; the hero is the onboarding).
*Perf budget*: first frame < 1 s (bundled poster), interactive < 2.5 s on a mid-range Android [Guessing: measure].

### 2. Destination (region) screen
Collapsing hero image, "N packages · from ₹X", list of packages (card: image, nights, from-price, tagline), "Places" grid, "Browse on map" button, best months strip (existing monthly scores), visa note for Indian passport.

### 3. Package detail
Image gallery (swipe), price "from ₹X per person (flight extra)" with the flight disclosure the web already makes, day-wise outline, inclusions/exclusions, sticky **Request a quote** (sign-in sheet if guest) and **Customise in planner** (pre-fills the planner with this package, using `matchReferencePackage`).

### 4. Planner (guest OK)
Four full-screen steps, one question each, progress dots, back swipe:
1. **Where** — search field, "Popular", region chips, selected places as reorderable chips with a route strip, "Pick on map" opens the map modal.
2. **When** — native date picker + nights stepper (bounds from `computeNightsBounds`), "Flexible" shortcut.
3. **Who** — traveller type cards, adults/children steppers with child ages, rooms.
4. **Style** — hotel class, pace, interests as chips; "Fine-tune" sheet holds the rest.
The **price bar** is visible from step 1 as soon as one place is chosen.

### 5. Map modal
Full screen, close button, region switcher (segmented), pinch/pan/double-tap zoom with momentum, pins with clusters at low zoom and labels at high zoom (existing declutter), selected pins gold, route line between chosen places, **bottom sheet card** for the tapped place with image, "Add to trip", and a "List view" toggle that is the accessible equivalent. Safe-area aware. Reset-view button.

### 6. Quote
Header summary, big price with "for 2 adults · 11 nights", Itinerary timeline, "What's included" accordion, cost split by category (what the traveller sees today; the agency's line-by-line split stays admin-only), notes/advisories, pinned **Send to Retro for final quote**. The quote is an estimate: say so, and say a human confirms the final price (this is the existing business flow).

### 7. Sign-in sheet
Over the current screen. "Continue with Apple" (iOS), "Continue with Google", email + password with show/hide, forgot password. Explains *why*: "So Retro can send your final quote here." Draft preserved.

### 8. Trips and the quote conversation
Segmented list: **Needs you**, **With Retro**, **Confirmed**. The first segment is the ones where the move is the traveller's (quoted, accepted, part_paid), so the answer to "what do I do next?" is always the top row. Each trip is a single **conversation screen**, not a form:
- A progress strip (Request sent · Being prepared · Final quote · Payment · Confirmed) and a status sentence from the existing `STATUS_COPY`.
- A **thread**: events and messages in time order, newest at the bottom, with a message box pinned above the keyboard (**Ask Retro a question** never changes the quote's status).
- The current **quote card**: total, validity countdown ("open for 3 days"), optional extras (tickable), deposit, and when it is a revision, a **What changed since v1** card (total, per-category deltas, the agency's note).
- One primary action for the state: **Accept and pay** when quoted; **Pay balance** when part-paid. Secondary, quieter: **Request changes** (with chips Dates · Hotels · Activities · Budget · Other), **Decline**. In `changes_requested` and `in_review` the card says whose move it is and when they last looked.
- Payment opens the secure browser; on return, a "Confirming your payment" state until the server confirms (doc 01, B4).
- "Need to change or cancel this booking?" opens WhatsApp prefilled with the booking reference once money has moved (doc 07, N8).
Quote offer mirrors the web `QuoteOffer`; the web has no thread or diff, so these are additions.

### 9. Talk to us (chat)
A sheet: greeting, quick-reply chips, one question at a time; ends with phone number, then **Send on WhatsApp** and **Call me instead**. Detail in doc 04.

### 10. Staff
Specified in doc 07: Queue (Your move / Waiting / Done), Request detail with Call · WhatsApp · Email, Quote editor (Trip · Pricing · Price split with per-line checkboxes), Leads. Same dark design language, denser rows, `expo-screen-capture` and biometric re-lock.

### 11. More
Profile, WhatsApp/phone/email rows, policies (privacy, terms, refund, cancellation, payment), **Delete my account**, app version, sign out.

## Empty, error and edge states (each designed, not left to chance)
Offline banner with cached content, "couldn't load" with retry, no results with suggestions, quote engine cannot price a combination (explain which choice and offer the nearest valid one, mirroring `evaluatePlaceSelectability` messages), payment pending / failed / succeeded, session expired, forced update, maintenance.

## UX acceptance criteria
- A guest reaches a live price in **4 taps or fewer** from launch ("Plan my trip" → pick a place → accept defaults → Quote).
- No tap target under 44 pt; text scales with system settings; every image has a label.
- Map is never mandatory and never traps the scroll.
- Killing the app mid-planner and relaunching restores the draft.
- First launch works in airplane mode (bundled catalogue) with a clear "you're offline" note on live-only items.
- From any Trips row the traveller can say what happens next and whose move it is in under 2 seconds of looking.
- A revision always shows what changed from the previous version.
- A dropped connection never loses a typed message, a draft, or a chat lead, and never creates a duplicate.
