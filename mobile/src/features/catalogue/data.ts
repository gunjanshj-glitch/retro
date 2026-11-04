/**
 * Typed, lazily parsed access to the on-device catalogue. Parsing happens on first use and is cached per
 * revision, so opening the planner never re-reads the 3 MB core file.
 */
import type { CoreBundle, DestinationBundle, Route, VisaRule } from "@retro/core/atlas/schema";
import type { Local } from "./storage";
import { exists, readJson, readText } from "./storage";

export type PackageCard = {
  id: string; name: string; slug: string; destinationSlug: string; regionId: string;
  nights: number; days: number; priceFromInr: number; priceIncludesFlight: boolean; tagline: string | null; coverImage: string;
};

export type Catalogue = {
  revision: string;
  core: CoreBundle;
  routes: Route[];
  visaRules: VisaRule[];
  packageCards: PackageCard[];
  destination(slug: string): DestinationBundle | null;
  regionMapSvg(regionId: string): string | null;
  regionMarkers<T>(regionId: string): T | null;
};

const cache = new Map<string, Catalogue>();

export function openCatalogue(local: Local): Catalogue {
  const hit = cache.get(local.manifest.revision);
  if (hit) return hit;
  const dest = new Map<string, DestinationBundle | null>();
  const catalogue: Catalogue = {
    revision: local.manifest.revision,
    core: readJson<CoreBundle>(local, "atlas/core.json"),
    routes: readJson<{ routes: Route[] }>(local, "atlas/routes.json").routes,
    visaRules: readJson<{ rules: VisaRule[] }>(local, "atlas/visa.json").rules,
    packageCards: readJson<PackageCard[]>(local, "atlas/package-cards.json"),
    destination(slug) {
      if (!dest.has(slug)) dest.set(slug, exists(local, `atlas/destinations/${slug}.json`) ? readJson<DestinationBundle>(local, `atlas/destinations/${slug}.json`) : null);
      return dest.get(slug) ?? null;
    },
    regionMapSvg(id) {
      return exists(local, `maps/${id}.svg`) ? readText(local, `maps/${id}.svg`) : null;
    },
    regionMarkers<T>(id: string) {
      return exists(local, `maps/${id}.markers.json`) ? (readJson<T>(local, `maps/${id}.markers.json`)) : null;
    },
  };
  cache.clear();
  cache.set(local.manifest.revision, catalogue);
  return catalogue;
}

/** Applies the synced commercial policy, then loads the engine. The order matters: see runtime-policy.ts. */
let enginePromise: ReturnType<typeof loadEngine> | null = null;
function loadEngine(local: Local) {
  const { applyRuntimePolicy } = require("@retro/core/atlas/engine/runtime-policy") as typeof import("@retro/core/atlas/engine/runtime-policy");
  const policy = exists(local, "atlas/engine/quote-policy.json") ? readJson<unknown>(local, "atlas/engine/quote-policy.json") : undefined;
  const calibration = exists(local, "atlas/engine/pricing-calibration.json") ? readJson<unknown>(local, "atlas/engine/pricing-calibration.json") : undefined;
  applyRuntimePolicy({ policy, calibration });
  return require("@retro/core/atlas/engine") as typeof import("@retro/core/atlas/engine");
}
let engineRevision = "";
export function getEngine(local: Local) {
  if (!enginePromise || engineRevision !== local.manifest.revision) {
    enginePromise = loadEngine(local);
    engineRevision = local.manifest.revision;
  }
  return enginePromise;
}
