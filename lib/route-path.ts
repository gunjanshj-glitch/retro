/**
 * Straight "directions" polyline between the places a traveller has picked, in
 * the order they picked them.
 *
 * Pure geometry in map units — the same coordinate space the pins are placed in
 * (`marker.cx` / `marker.cy`), so when the result is drawn inside the map's own
 * <svg viewBox> it shares the pins' projection and follows pan and zoom for
 * free. Screen-sized things (the gap left around each pin, the arrowheads) are
 * given in px and converted with `k`, the map units per screen px.
 */

export type RoutePoint = { cx: number; cy: number };

export type RouteSegment = { x1: number; y1: number; x2: number; y2: number };

export type RouteArrow = { x: number; y: number; /** Direction of travel, degrees, 0 = +x (east). */ angle: number };

export type RoutePath = {
  segments: RouteSegment[];
  /** One arrowhead per segment, at its midpoint, pointing from stop to next stop. */
  arrows: RouteArrow[];
  /** SVG path data for all segments (`M..L..` per segment), "" when there is nothing to draw. */
  d: string;
};

export type RouteOptions = {
  /** Map units per screen px (1 / pxPerUnit). */
  k: number;
  /** Shift every stop up by this many px — a pin's bulb sits above its anchor point. */
  liftPx?: number;
  /** Leave this many px clear at both ends of each segment so the line does not run through the pins. */
  trimPx?: number;
  /** Segments shorter than this (px, after trimming) get no arrowhead. */
  minArrowPx?: number;
};

const EMPTY: RoutePath = { segments: [], arrows: [], d: "" };

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Builds the polyline for stops given in selection order.
 *
 * - Fewer than two usable stops: nothing to draw.
 * - Consecutive stops at the same spot are collapsed (no zero-length segment).
 * - Segments too short to survive trimming are dropped rather than inverted.
 */
export function buildRoutePath(stops: RoutePoint[], opts: RouteOptions): RoutePath {
  const { k, liftPx = 0, trimPx = 0, minArrowPx = 28 } = opts;
  if (!(k > 0) || stops.length < 2) return EMPTY;

  const pts = stops
    .filter((s) => Number.isFinite(s.cx) && Number.isFinite(s.cy))
    .map((s) => ({ x: s.cx, y: s.cy - liftPx * k }));

  const segments: RouteSegment[] = [];
  const arrows: RouteArrow[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const trim = trimPx * k;
    if (len <= trim * 2) continue;
    const ux = dx / len;
    const uy = dy / len;
    const seg = { x1: a.x + ux * trim, y1: a.y + uy * trim, x2: b.x - ux * trim, y2: b.y - uy * trim };
    segments.push(seg);
    if ((len - trim * 2) / k >= minArrowPx) {
      arrows.push({
        x: (seg.x1 + seg.x2) / 2,
        y: (seg.y1 + seg.y2) / 2,
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      });
    }
  }

  const d = segments.map((s) => `M${fmt(s.x1)},${fmt(s.y1)}L${fmt(s.x2)},${fmt(s.y2)}`).join("");
  return { segments, arrows, d };
}

/**
 * Resolves the picked place ids, in order, to the points that are on this map.
 * Places the map does not carry (picked in another region) are skipped, so the
 * line simply joins the stops either side of them.
 */
export function routeStops(order: string[], positions: Map<string, RoutePoint>): RoutePoint[] {
  const out: RoutePoint[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = positions.get(id);
    if (p) out.push(p);
  }
  return out;
}
