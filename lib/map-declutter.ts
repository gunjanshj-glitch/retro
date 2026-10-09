/**
 * Progressive pin disclosure for the region maps.
 *
 * A region map can carry hundreds of places, far more than fit on a screen
 * without overlapping. Rather than nudging pins aside (which misplaces them) or
 * capping the list by hand, this decides — from the screen size and the current
 * zoom — which pins to draw, under one strict rule:
 *
 *   No two visible pins are ever closer than `spacingPx` (centre to centre),
 *   and that is never less than one pin diameter plus a fixed visible gap.
 *
 * Pins come in two levels. A **country** pin (level 0) stands for a whole
 * country — or, for India, a state — and is what a zoomed-out map shows. The
 * **places** inside it (level 1) take over as the traveller zooms in and there
 * is room for them. A country that has only one place is not split: that place
 * is shown directly.
 *
 * The result depends only on the pins, the viewport size and the zoom — never
 * on where the map is panned to — so dragging the map cannot make pins swap
 * places or flicker.
 */

export type PinLevel = 0 | 1;

export type DeclutterPin = {
  id: string;
  /** Position in map units. */
  x: number;
  y: number;
  /** Country (or state) this pin belongs to; the key level-0 pins group on. */
  country: string;
  /** 0 = the country's own pin, 1 = a place within it. */
  level: PinLevel;
  /** Lower is shown first within a country. Ignored for level 0. */
  rank: number;
  /** Always shown and always wins its spot (e.g. a place already selected). */
  pinned?: boolean;
};

export type ViewportClass = "phone" | "tablet" | "desktop";

export type PinMetrics = {
  viewport: ViewportClass;
  /** Radius of a pin's footprint, in screen px. */
  radiusPx: number;
  /** Smallest visible gap between two pins' footprints, in screen px. */
  gapPx: number;
  /** How many pins one screenful of map is meant to hold, roughly. */
  targetPins: number;
};

/**
 * Below this zoom a map shows countries only. The places inside a country that
 * has its own pin do not appear until the traveller has actually zoomed in, so
 * the first view is always the country level, however far apart a country's
 * places happen to lie.
 */
export const PLACE_ZOOM = 1.6;

/** Zoom level at which the density rule has fully relaxed to the hard gap. */
export const DENSE_ZOOM = 6;

export function classifyViewport(widthPx: number): ViewportClass {
  if (widthPx < 640) return "phone";
  if (widthPx < 1024) return "tablet";
  return "desktop";
}

/**
 * The pin footprint and the density target for a viewport.
 *
 * Smaller screens get a smaller footprint but a much lower target — a thumb
 * needs room, and a phone map holds far fewer readable pins than a desktop one.
 */
export function pinMetrics(widthPx: number): PinMetrics {
  const viewport = classifyViewport(widthPx);
  if (viewport === "phone") return { viewport, radiusPx: 10, gapPx: 8, targetPins: 8 };
  if (viewport === "tablet") return { viewport, radiusPx: 11, gapPx: 8, targetPins: 16 };
  return { viewport, radiusPx: 12, gapPx: 8, targetPins: 28 };
}

/** The hard minimum centre-to-centre distance: one diameter plus the gap. */
export function minSpacingPx(metrics: PinMetrics): number {
  return metrics.radiusPx * 2 + metrics.gapPx;
}

/**
 * Centre-to-centre spacing to enforce at a given size and zoom.
 *
 * Zoomed out, it follows the density target so the map reads as a handful of
 * well-separated pins. As the traveller zooms in it relaxes towards the hard
 * minimum, so by `DENSE_ZOOM` every pin that can be shown without touching its
 * neighbour is shown. It never drops below the hard minimum.
 */
export function spacingPx(
  widthPx: number,
  heightPx: number,
  zoom: number,
  metrics: PinMetrics = pinMetrics(widthPx),
): number {
  const hard = minSpacingPx(metrics);
  const area = Math.max(1, widthPx * heightPx);
  const density = 0.55 * Math.sqrt(area / metrics.targetPins);
  const t = Math.min(1, Math.max(0, (zoom - 1) / (DENSE_ZOOM - 1)));
  return Math.max(hard, density + (hard - density) * t);
}

export type DeclutterInput = {
  pins: DeclutterPin[];
  /** Screen pixels per map unit at the current zoom. */
  pxPerUnit: number;
  widthPx: number;
  heightPx: number;
  zoom: number;
};

export type DeclutterResult = {
  /** Ids of the pins to draw. */
  visible: Set<string>;
  /** Countries shown expanded (their places drawn, their own pin hidden). */
  expanded: Set<string>;
  /** The spacing that was enforced, in screen px. */
  spacingPx: number;
};

function dist(a: DeclutterPin, b: DeclutterPin, pxPerUnit: number): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * pxPerUnit;
}

/**
 * Chooses which pins to draw.
 *
 * 1. Places are admitted round-robin across countries by rank — every
 *    country's best place gets a turn before any country's second — each only
 *    if it clears every pin already admitted by the spacing rule.
 * 2. A country whose places mostly got in (two or more, or all of them when it
 *    has fewer) is *expanded*: its places are drawn and its own pin is not.
 * 3. Every other country keeps its own pin, admitted in order of how many
 *    places it holds, if it clears everything already drawn.
 *
 * Pinned pins are admitted before everything else and are never dropped.
 */
export function selectVisiblePins(input: DeclutterInput): DeclutterResult {
  const { pins, pxPerUnit, widthPx, heightPx, zoom } = input;
  const spacing = spacingPx(widthPx, heightPx, zoom);
  const visible = new Set<string>();
  const expanded = new Set<string>();

  const countryPins = new Map<string, DeclutterPin>();
  for (const p of pins) if (p.level === 0) countryPins.set(p.country, p);
  // A country with its own pin shows only that pin until the map is zoomed in;
  // a place with no country pin above it (Monaco, say) is always drawn.
  const places = pins.filter((p) => p.level === 1 && (zoom >= PLACE_ZOOM || !countryPins.has(p.country) || p.pinned));

  const placesByCountry = new Map<string, DeclutterPin[]>();
  for (const p of places) {
    const list = placesByCountry.get(p.country);
    if (list) list.push(p);
    else placesByCountry.set(p.country, [p]);
  }
  for (const list of placesByCountry.values()) list.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));

  const accepted: DeclutterPin[] = [];
  const clears = (candidate: DeclutterPin) =>
    accepted.every((other) => dist(candidate, other, pxPerUnit) >= spacing);

  // Pinned pins first: they always win their spot, even over each other.
  for (const p of pins) {
    if (!p.pinned) continue;
    accepted.push(p);
    visible.add(p.id);
  }

  // Countries ordered by how much they hold, so the busiest get the first turn.
  const countries = [...placesByCountry.keys()].sort(
    (a, b) => (placesByCountry.get(b)?.length ?? 0) - (placesByCountry.get(a)?.length ?? 0) || a.localeCompare(b),
  );

  // Pass 1: round-robin admission of places.
  const admitted = new Map<string, DeclutterPin[]>();
  const maxRank = Math.max(0, ...countries.map((c) => placesByCountry.get(c)!.length));
  for (let turn = 0; turn < maxRank; turn++) {
    for (const country of countries) {
      const candidate = placesByCountry.get(country)![turn];
      if (!candidate) continue;
      if (candidate.pinned) {
        const list = admitted.get(country) ?? [];
        list.push(candidate);
        admitted.set(country, list);
        continue;
      }
      if (!clears(candidate)) continue;
      accepted.push(candidate);
      const list = admitted.get(country) ?? [];
      list.push(candidate);
      admitted.set(country, list);
    }
  }

  // Pass 2: decide which countries are expanded, and release the rest.
  const keep = new Set<string>(pins.filter((p) => p.pinned).map((p) => p.id));
  for (const country of countries) {
    const all = placesByCountry.get(country)!;
    const got = admitted.get(country) ?? [];
    const threshold = Math.min(2, all.length);
    // A single-place country has no pin of its own to hide behind: its place
    // *is* the country pin, so it is drawn whenever it fits.
    if (got.length >= threshold) {
      expanded.add(country);
      for (const p of got) keep.add(p.id);
    }
  }

  // Rebuild the accepted set from only what survived, then add country pins.
  const survivors = accepted.filter((p) => keep.has(p.id));
  accepted.length = 0;
  accepted.push(...survivors);
  for (const p of survivors) visible.add(p.id);
  for (const id of [...visible]) if (!keep.has(id)) visible.delete(id);

  // Every country that did not expand keeps its own pin — including those whose
  // places were held back below the place zoom.
  const holdings = new Map<string, number>();
  for (const p of pins) if (p.level === 1) holdings.set(p.country, (holdings.get(p.country) ?? 0) + 1);
  const collapsed = [...holdings.keys()]
    .filter((c) => !expanded.has(c))
    .sort((a, b) => (holdings.get(b) ?? 0) - (holdings.get(a) ?? 0) || a.localeCompare(b));
  for (const country of collapsed) {
    const pin = countryPins.get(country);
    if (!pin) continue;
    if (!clears(pin)) continue;
    accepted.push(pin);
    visible.add(pin.id);
  }

  return { visible, expanded, spacingPx: spacing };
}

/**
 * Verifies the one rule that matters. Used by tests and by development
 * assertions: returns the closest pair of drawn pins, in screen px, so a caller
 * can check it never falls below the spacing that was enforced.
 */
export function closestPairPx(drawn: DeclutterPin[], pxPerUnit: number): number {
  let best = Infinity;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      best = Math.min(best, dist(drawn[i], drawn[j], pxPerUnit));
    }
  }
  return best;
}

export type LabelItem = {
  id: string;
  /** Pin centre in screen px. */
  px: number;
  py: number;
  text: string;
};

type Rect = { x0: number; y0: number; x1: number; y1: number };

const LABEL_HEIGHT = 14;
const CHAR_WIDTH = 6.4;

const rectsOverlap = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x0, Math.min(cx, rect.x1));
  const ny = Math.max(rect.y0, Math.min(cy, rect.y1));
  return Math.hypot(cx - nx, cy - ny) < r;
}

/**
 * Decides which drawn pins also get a name label, and on which side.
 *
 * A label is only shown where it overlaps neither another pin nor an earlier
 * label — so labelling can never add clutter, and a pin without room for its
 * name still stands as a clean dot (its name appears on hover). Items are given
 * in priority order; earlier ones claim space first.
 */
export function placePinLabels(items: LabelItem[], radiusPx: number): Map<string, "right" | "left"> {
  const out = new Map<string, "right" | "left">();
  const taken: Rect[] = [];
  for (const item of items) {
    const w = item.text.length * CHAR_WIDTH + 6;
    const sides: ["right" | "left", Rect][] = [
      ["right", { x0: item.px + radiusPx + 2, y0: item.py - LABEL_HEIGHT / 2, x1: item.px + radiusPx + 2 + w, y1: item.py + LABEL_HEIGHT / 2 }],
      ["left", { x0: item.px - radiusPx - 2 - w, y0: item.py - LABEL_HEIGHT / 2, x1: item.px - radiusPx - 2, y1: item.py + LABEL_HEIGHT / 2 }],
    ];
    for (const [side, rect] of sides) {
      const hitsPin = items.some((o) => o.id !== item.id && circleHitsRect(o.px, o.py, radiusPx, rect));
      if (hitsPin || taken.some((t) => rectsOverlap(t, rect))) continue;
      out.set(item.id, side);
      taken.push(rect);
      break;
    }
  }
  return out;
}
