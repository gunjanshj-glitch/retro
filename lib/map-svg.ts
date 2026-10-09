/**
 * Shared types and SVG helpers for the region maps.
 *
 * `scripts/build-maps` writes `<region>.svg` (outline only) and
 * `<region>.markers.json` (every pin, with its level and country). These are
 * the client-side shapes of those files.
 */
import type { Box, ViewBox } from "./use-zoom-pan";

export type MapMarker = {
  name: string;
  cx: number;
  cy: number;
  type: "city" | "poi";
  subtype?: string;
  group?: number;
  country: string;
  /** 0 = the country's own pin, 1 = a place within it. */
  level: 0 | 1;
  rank: number;
  label?: string;
  aggregate?: boolean;
  count?: number;
  places?: string[];
};

export type RegionMarkers = { viewBox: ViewBox; markers: MapMarker[] };

/** A stable key for a pin; level-0 and level-1 pins can share a name. */
export const markerKey = (m: MapMarker) => `${m.level}:${m.country}:${m.name}`;

/** Splits a generated region SVG into its outline path and any other layers. */
export function parseRegionSvg(svg: string): { coastline: string | null; decorations: string } {
  const coastline = svg.match(/<path\s+d="([^"]+)"[^>]*data-role="coastline"/)?.[1] ?? null;
  const decorations = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<g data-marker-name="[^"]*"[\s\S]*?<\/g>/g, "")
    .replace(/<path\s+[^>]*data-role="coastline"[^>]*\/>/g, "");
  return { coastline, decorations };
}

/** Bounding box of a country's place pins, for zooming into it. */
export function countryBox(markers: MapMarker[], country: string): Box | null {
  const own = markers.filter((m) => m.country === country && m.level === 1);
  if (!own.length) return null;
  return {
    x0: Math.min(...own.map((m) => m.cx)),
    y0: Math.min(...own.map((m) => m.cy)),
    x1: Math.max(...own.map((m) => m.cx)),
    y1: Math.max(...own.map((m) => m.cy)),
  };
}
