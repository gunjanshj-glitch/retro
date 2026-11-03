# 02. Architecture and folder structure

## Framework decision

| Option | UI reuse | Feel on phone | Store risk | Verdict |
|---|---|---|---|---|
| **Capacitor / webview around the site** | high | web page in a frame; map and 679-line planner unchanged | guideline 4.2 "repackaged website" risk [Likely] | Rejected: reuses exactly what fails on a phone |
| **Expo (React Native)** | none for DOM UI; full for logic | native lists, sheets, gestures, 60 fps | low | **Chosen** |
| Flutter | none | excellent | low | Rejected: rewrites logic too, new language, no shared engine |
| Native Swift + Kotlin | none | best | low | Rejected: two codebases, double cost |

Why Expo specifically: the web is React 19 + TypeScript, so the team, the engine, `zod` schemas and mental model carry over; EAS builds iOS without owning a Mac (cloud), OTA updates fix JS bugs without store review, and `@expo/ui` renders genuine SwiftUI / Jetpack Compose controls, which is what makes it feel native rather than "web in an app" [Certain: Expo docs]. Expo itself documents a web-to-native path ("strangler" migration) that the vendored `expo-web-to-native` skill drives.

**Escape hatch kept:** Expo's `'use dom'` components run web React inside a webview. Use them only for low-value screens that are mostly text (policy pages) so they ship on day one. Each DOM screen carries roughly 2 MB of web runtime [Certain: skill text], so never for hot paths.

## What is shared, honestly

| Layer | Shared with web? | How |
|---|---|---|
| Pricing engine `lib/atlas/engine/*` | **yes, unchanged** | package `@retro/core`, runs in Hermes. Guarded by golden-fixture parity test |
| Catalogue schema `lib/atlas/schema.ts`, zod `QuoteRequest` | yes | `@retro/core` |
| Quote maths `lib/quote-pricing.ts` (already Worker-safe) | yes | `@retro/core` |
| Policy and calibration JSON (`content/*.json`) | yes | imported by core |
| Contact constants `lib/contact.ts` | yes | `@retro/core` |
| API client (fetch wrappers, error mapping) | yes, auth transport differs | `@retro/api-client`: cookie on web, bearer on mobile |
| Chat flow definition + runner | yes | `@retro/chat-flow` |
| Zoom/pan maths, pin hit-radius (`map-pins.ts`, `map-declutter.ts`) | yes, pure functions | `@retro/core` |
| React components (`components/*`) | **no** | rewritten in React Native |
| Next routes, Tailwind classes, CSS, DOM hooks (`use-zoom-pan.ts` uses pointer events) | **no** | replaced |

So: logic is shared; every pixel is new. That is deliberate. Reusing the web components would reproduce the web UX.

## Repo layout

Do **not** move the existing web app in this project. Add alongside it, extract shared code gradually, and keep web imports working through re-export shims.

```
retro/
├── app/ components/ lib/ content/ public/ scripts/ tests/   # web (unchanged location)
├── workers/
│   ├── api/                  # backend Worker (extended per doc 01)
│   └── web/
├── packages/                 # NEW, npm workspaces
│   ├── core/                 # engine, schema, quote-pricing, map maths, contact, policy JSON
│   │   └── src/ …            # lib/atlas/* is moved here; lib/atlas/* re-exports for web
│   ├── contracts/            # zod request/response schemas for every endpoint
│   ├── api-client/           # typed fetch client; AuthTransport = cookie | bearer
│   └── chat-flow/            # flow.json + pure runner (no UI)
├── mobile/                   # NEW, Expo app (SDK current at start)
│   ├── app/                  # Expo Router file-based routes
│   │   ├── _layout.tsx       # providers, fonts, splash, update gate
│   │   ├── (tabs)/
│   │   │   ├── index.tsx         # Explore (home)
│   │   │   ├── plan.tsx          # Planner entry
│   │   │   ├── trips.tsx         # My trips (auth-gated)
│   │   │   └── more.tsx          # Account, contact, policies
│   │   ├── destination/[slug].tsx
│   │   ├── package/[slug].tsx
│   │   ├── plan/{where,when,who,style,quote}.tsx
│   │   ├── map.tsx               # full-screen map modal
│   │   ├── trip/[id].tsx         # quote offer, thread, accept, pay (doc 07)
│   │   ├── (staff)/              # role-gated, lazy: queue, request/[id], editor/[id], leads (doc 07)
│   │   ├── auth.tsx              # sheet route
│   │   ├── chat.tsx              # sheet route
│   │   └── legal/[doc].tsx
│   ├── src/
│   │   ├── features/{explore,destinations,packages,planner,quote,trips,auth,chat,map,staff}/
│   │   ├── ui/               # design-system components (Button, Card, Sheet, PriceBar, Chip…)
│   │   ├── theme/            # tokens: colour, type, spacing, radius, motion
│   │   ├── data/             # catalogue loader, cache, manifest sync
│   │   ├── platform/         # ios.ts / android.ts adaptations (haptics, share, back, permissions)
│   │   └── lib/{secure-store,analytics,push,deeplinks,env}.ts   # push + deeplinks + auth are provider adapters (doc 08)
│   ├── assets/               # fonts, icon, splash, bundled portrait posters + clips, catalogue snapshot
│   ├── app.config.ts         # bundle ids, scheme, associated domains, per-env config
│   ├── eas.json              # build profiles: development / preview / production
│   ├── maestro/              # E2E flows (YAML)
│   └── __tests__/
├── docs/mobile/              # this plan
└── .claude/skills/           # vetted Expo skills
```

Monorepo mechanics [Likely, verify in spike]: npm workspaces; Expo's Metro auto-detects workspaces in current SDKs; the web keeps `@/lib/...` aliases that re-export from `@retro/core`. Because `content/*.json` is imported by the engine, `packages/core` imports it by relative path or the JSON moves into the package with a re-export. Decide in the spike.

### iOS vs Android adaptation
**Tablets:** v1 is **iPhone-only** (`supportsTablet: false`), which avoids iPad screenshots and layouts; iPad runs it in compatibility mode. Android tablets get a centred column. This was an open question you did not answer; say so if you want a true tablet layout.

One codebase; platform differences live in `src/platform/` and in file suffixes (`Thing.ios.tsx`, `Thing.android.tsx`) only where genuinely different:

| Concern | iOS | Android |
|---|---|---|
| Navigation chrome | large titles, swipe-back, native tab bar | Material top bar, system back gesture/button |
| Sheets, pickers, toggles | SwiftUI via `@expo/ui` | Jetpack Compose via `@expo/ui` |
| Haptics | light impact on select | `Haptics` selection |
| Sign-in extras | Sign in with Apple, only if Google is offered (doc 01, B2) | Google |
| Payments | UPI app switch, test on device | UPI intent |
| Permissions | notifications ask at a meaningful moment, never on launch | Android 13+ notification permission, same rule |
| Updates | App Store + EAS Update | Play + EAS Update |

## Data layer on device

- **Catalogue**: bundle a snapshot (core, routes, visa, package-cards ≈ 4.7 MB raw JSON, far less compressed [Likely]) so the first launch works offline. Per-place bundles (11 MB) and guidance (11 MB) download on demand into the file system and are cached; the manifest (doc 01, O1) says what is stale. Parsing 2.9 MB of JSON on Hermes should take on the order of 100 to 300 ms [Guessing: measure in the spike, this is the key performance number].
- **Engine** runs off the JS thread's critical path: wrap `generateQuotation` in a debounced call so dragging a slider never blocks; show the previous price dimmed until the new one lands.
- **State**: TanStack Query for server data (requests, auth, config); Zustand (or Context) for the planner draft; draft persisted to MMKV/AsyncStorage so a sign-in redirect or app kill loses nothing.
- **Secrets**: bearer token in `expo-secure-store` (Keychain / Keystore). Never AsyncStorage. Staff screens add a biometric re-lock and block screenshots (doc 07).
- **Writes**: online-only with a clear error, except chat leads, which queue locally under a client-generated `Idempotency-Key` and retry. Every create/send carries a key (doc 01, B7).
- **Catalogue version** is stamped on every quote the app produces and shown on the quote screen (doc 01, O10).
- **Images**: `expo-image` with disk cache; variants chosen by screen width.

## Spike to run before committing (one to two days)
1. Run the engine inside Expo on a mid-range Android; time `loadCore` + `generateQuotation` for the Rajasthan trip.
2. 20 golden `QuoteRequest` fixtures → identical totals on Node and Hermes.
3. Render `india.svg` with 54 pins at 60 fps with pinch/pan using `react-native-svg` + Reanimated + Gesture Handler. If it stutters, switch the base map layer to Skia (kept as a drop-in).
4. Confirm `@expo/ui` components run in Expo Go for the target SDK.
5. Check the web timeline renders an unknown event type (`message`) by its summary, and that the staff editor's controls are all reachable in the planner's expert mode (doc 07).
If any fails, this document changes before code is written.
