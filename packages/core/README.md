# @retro/core

The platform-neutral domain code. The website, the API Worker and the mobile app all import it, so a
price, a quote status or a phone number is defined once.

| Path | What |
|---|---|
| `atlas/schema.ts` | Zod schemas for the compiled catalogue (the ETL output) |
| `atlas/engine/` | The quotation engine: itinerary, day plan, pricing, advisories, decision rules |
| `atlas/iso.ts`, `departure-cities.ts`, `map-pins.ts` | Reference data and map geometry |
| `quote-pricing.ts` | Prices a sent quote (optional lines, deposit, split). Also used by the Worker for every payment amount |
| `quote-workflow.ts` | The request state machine and the traveller-facing status copy |
| `contact.ts` | Phone and WhatsApp numbers |
| `map-declutter.ts` | Progressive pin disclosure for dense maps |

## Rules

- **Portable.** No React, no Next, no Node built-ins, no `window`/`document`. `tests/unit/core-package-boundary.test.ts`
  fails the build if one appears; the mobile app (Hermes) would otherwise find out on a phone.
- **No build step.** The package ships TypeScript source. Next compiles it (`transpilePackages`), Vite and tsx read it,
  wrangler bundles it, Metro handles it as a workspace package.
- **Data stays in `content/`.** The engine imports `content/quote-policy.json` and `content/pricing-calibration.json` by
  relative path, so `scripts/etl/calibrate.ts` and the content team keep editing them where they always have.
- **Imports** use the deep path: `import { generateQuotation } from "@retro/core/atlas/engine"`.

## Where the rest went

`lib/atlas/client.ts` (fetches `/atlas/*.json` over HTTP) and `lib/atlas/use-quotation.ts` (a React hook) stay in the web
app: they assume a browser. The app will load the catalogue from its bundled snapshot instead (docs/mobile/02).
`lib/auth-client.ts` becomes `packages/api-client` when the app needs bearer-token transport.
