import type { Place } from "@retro/core/atlas/schema";

/** Catalogue region id -> the map file built for it (public/maps/<asset>.svg). */
export const REGION_ASSET: Record<string, string> = {
  africa: "africa", "eurasia-cis": "eurasia-cis", russia: "russia", "south-asia": "south-asia", "east-asia": "east-asia",
  europe: "europe", "middle-east-and-gulf": "middle-east", oceania: "oceania", "south-east-asia": "south-east-asia", india: "india",
};

export type MapMarker = {
  name: string; cx: number; cy: number; type: string; country: string; level: 0 | 1; rank: number;
  label?: string; aggregate?: boolean; count?: number; places?: string[];
};
export type RegionMarkers = { viewBox: [number, number, number, number]; markers: MapMarker[] };

export type MapPin = { key: string; marker: MapMarker; place: Place | undefined; cx: number; cy: number };

export const markerKey = (m: MapMarker) => `${m.level}:${m.country}:${m.name}`;

/** The outline path of a generated region SVG. */
export function coastlinePath(svg: string): string | null {
  return svg.match(/<path\s+d="([^"]+)"[^>]*data-role="coastline"/)?.[1] ?? svg.match(/<path\s+d="([^"]+)"/)?.[1] ?? null;
}

/** Pins the traveller can act on: a supported place, or a country grouping that zooms in. Same rule as the website. */
export function buildPins(markers: RegionMarkers, placeByName: Map<string, Place>): MapPin[] {
  const seen = new Set<string>();
  const out: MapPin[] = [];
  for (const marker of markers.markers) {
    const place = placeByName.get(marker.name.toLowerCase());
    if (!place && !(marker.level === 0 && marker.aggregate)) continue;
    if (place) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
    }
    out.push({ key: markerKey(marker), marker, place, cx: marker.cx, cy: marker.cy });
  }
  return out;
}

/** Pins within `radius` screen points of a touch, nearest first. */
export function pinsNear(pins: { pin: MapPin; x: number; y: number }[], x: number, y: number, radius: number) {
  return pins
    .map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) }))
    .filter((p) => p.d <= radius)
    .sort((a, b) => a.d - b.d);
}
