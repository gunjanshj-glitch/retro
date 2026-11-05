/**
 * The "region split" layer of a destination map: every country (or, on a
 * single-country map, every state) drawn as its own shape, plus the
 * neighbouring land around it in a neutral tone.
 *
 * The region SVG (`<slug>.svg`) keeps the merged outline that has always been
 * there: it stays the base fill, so land is never missing even where the
 * per-unit shapes differ slightly from it (India's own outline comes from the
 * India-view dataset, its states from the default admin1 file). This file adds
 * what that outline cannot do on its own: hover, highlight and zoom per unit.
 */
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import { geoPath, type GeoProjection } from "d3-geo";
import mapshaper from "mapshaper";
import { pointInPolygon } from "./geometry";

export type RegionUnit = {
  /** Display name from Natural Earth ("Italy", "Kerala"). */
  name: string;
  d: string;
  /** How many of the destination's places fall inside this unit. */
  places: number;
  /** Map groupings (the `country` of a marker) with a place inside this unit. */
  groups: string[];
};

export type RegionLayer = {
  units: RegionUnit[];
  context: string;
  /** Draw the merged outline from `<slug>.svg` underneath the units. */
  baseOutline: boolean;
  /** Small land dots under places on islands too small to draw (Azores, Maldives). */
  islets: string;
};

type RawMarker = { lat: number; lng: number; country: string };

function reverseRings(g: Geometry): Geometry {
  if (g.type === "Polygon") return { ...g, coordinates: (g as Polygon).coordinates.map((r) => [...r].reverse()) };
  if (g.type === "MultiPolygon")
    return { ...g, coordinates: (g as MultiPolygon).coordinates.map((p) => p.map((r) => [...r].reverse())) };
  return g;
}

function polygonsOf(g: Geometry): Polygon["coordinates"][] {
  if (g.type === "Polygon") return [(g as Polygon).coordinates];
  if (g.type === "MultiPolygon") return (g as MultiPolygon).coordinates;
  return [];
}

async function simplify(features: Feature<Geometry>[], percent: number): Promise<Feature<Geometry>[]> {
  if (!features.length) return [];
  const out = await mapshaper.applyCommands(
    `-i in.json -simplify ${percent}% keep-shapes -o out.json format=geojson`,
    { "in.json": JSON.stringify({ type: "FeatureCollection", features }) },
  );
  return (JSON.parse(out["out.json"]) as FeatureCollection).features as Feature<Geometry>[];
}

/** Lng/lat box of a feature, cheap and planar (fine for a coarse overlap test). */
function lngLatBox(f: Feature<Geometry>): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polygonsOf(f.geometry))
    for (const [x, y] of poly[0] ?? []) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}

/** How far from any drawn land (in degrees) a place must be to get an islet. */
const ISLET_MIN_OFFSHORE_DEG = 0.6;

function nearestVertexDeg(m: { lat: number; lng: number }, polys: Polygon["coordinates"][]): number {
  let best = Infinity;
  for (const poly of polys)
    for (const [x, y] of poly[0] ?? []) {
      const d = Math.hypot(x - m.lng, y - m.lat);
      if (d < best) best = d;
    }
  return best;
}

export async function buildRegionLayer(opts: {
  /** The units to draw: admin0 countries for a region map, admin1 states for a one-country map. */
  units: Feature<Geometry>[];
  /** Everything else that may appear around the map (admin0, same point of view). */
  neighbours: Feature<Geometry>[];
  markers: RawMarker[];
  projection: GeoProjection;
  viewBox: [number, number, number, number];
  unitSimplifyPercent: number;
  baseOutline: boolean;
}): Promise<RegionLayer> {
  const { projection, viewBox, markers } = opts;
  const [vx, vy, vw, vh] = viewBox;
  // Draw neighbouring land well past the viewBox so panning at full zoom-out
  // never reveals an edge, but clip it there so far-away coastlines cost nothing.
  const pad = Math.max(vw, vh) * 1.2;
  const previousClip = projection.clipExtent();
  projection.clipExtent([[vx - pad, vy - pad], [vx + vw + pad, vy + vh + pad]]);
  const pathGen = geoPath(projection).digits(1);

  // Only neighbours whose (generous) box is near the markers are worth drawing.
  const lngs = markers.map((m) => m.lng), lats = markers.map((m) => m.lat);
  const spanX = Math.max(...lngs) - Math.min(...lngs) + 20;
  const spanY = Math.max(...lats) - Math.min(...lats) + 20;
  const near: [number, number, number, number] = [
    Math.min(...lngs) - spanX, Math.min(...lats) - spanY, Math.max(...lngs) + spanX, Math.max(...lats) + spanY,
  ];
  const neighbours = opts.neighbours.filter((f) => {
    const [x0, y0, x1, y1] = lngLatBox(f);
    return x1 >= near[0] && x0 <= near[2] && y1 >= near[1] && y0 <= near[3];
  });

  const [units, context] = await Promise.all([
    simplify(opts.units, opts.unitSimplifyPercent),
    simplify(neighbours, 6),
  ]);

  const out: RegionUnit[] = [];
  for (const f of units) {
    const polys = polygonsOf(f.geometry);
    const inside = markers.filter((m) => polys.some((p) => pointInPolygon([m.lng, m.lat], p)));
    const d = pathGen({ ...f, geometry: reverseRings(f.geometry) } as never) ?? "";
    if (!d) continue;
    const props = f.properties ?? {};
    out.push({
      name: String(props.NAME ?? props.name_en ?? props.name ?? "Unknown"),
      d,
      places: inside.length,
      groups: [...new Set(inside.map((m) => m.country))].sort(),
    });
  }

  // A place on an island too small to survive simplification would float in
  // open sea; give it a small islet, as the merged outline always has.
  const unitPolys = units.flatMap((f) => polygonsOf(f.geometry));
  const r = Math.max(vw, vh) / 260;
  const islets = markers
    .filter((m) => !unitPolys.some((p) => pointInPolygon([m.lng, m.lat], p)))
    // A coastal city just outside a simplified shoreline is not an island.
    .filter((m) => nearestVertexDeg(m, unitPolys) > ISLET_MIN_OFFSHORE_DEG)
    .map((m) => projection([m.lng, m.lat]))
    .filter((p): p is [number, number] => !!p)
    .map(([x, y]) => `M${(x + r).toFixed(1)},${y.toFixed(1)}A${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(x - r).toFixed(1)},${y.toFixed(1)}A${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(x + r).toFixed(1)},${y.toFixed(1)}Z`)
    .join("");

  const contextD = context
    .map((f) => pathGen({ ...f, geometry: reverseRings(f.geometry) } as never) ?? "")
    .filter((d) => d.length > 12)
    .join("");

  projection.clipExtent(previousClip);
  return { units: out, context: contextD, baseOutline: opts.baseOutline, islets };
}
