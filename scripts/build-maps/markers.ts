/**
 * Turns a destination's flat marker list into the two-level pin set the maps
 * draw: one pin per country (or Indian state) for the zoomed-out view, and one
 * per place for when the traveller zooms in.
 *
 * Only supported places ever become pins — nothing here comes from geographic
 * data. A country's own pin is positioned at the centre of its places so it
 * reads as "the country", not as its capital.
 */

export type MarkerInput = {
  name: string;
  type: "city" | "poi";
  subtype?: string;
  group?: number;
  country?: string;
  /** True for a place that stands for the whole country (e.g. "France"). */
  countryLevel?: boolean;
  cx: number;
  cy: number;
};

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
  /** Position among the country's places; lower is shown first. */
  rank: number;
  /** Human label for a level-0 pin whose place name differs ("Czech" -> "Czechia"). */
  label?: string;
  /** True when no place stands for the country, so the pin is purely a grouping. */
  aggregate?: boolean;
  /** Level 0 only: how many places the country holds. */
  count?: number;
  /** Level 0 only: the country's first few places, in rank order. */
  places?: string[];
};

const PREVIEW_PLACES = 8;
const FALLBACK_COUNTRY = "Other";

function mostCommonGroup(markers: MarkerInput[]): number | undefined {
  const counts = new Map<number, number>();
  for (const m of markers) if (m.group != null) counts.set(m.group, (counts.get(m.group) ?? 0) + 1);
  let best: number | undefined;
  let bestN = 0;
  for (const [g, n] of counts) {
    if (n > bestN) {
      best = g;
      bestN = n;
    }
  }
  return best;
}

export function buildMarkerEntries(markers: MarkerInput[]): MapMarker[] {
  const byCountry = new Map<string, MarkerInput[]>();
  for (const m of markers) {
    const country = m.country ?? FALLBACK_COUNTRY;
    const list = byCountry.get(country);
    if (list) list.push(m);
    else byCountry.set(country, [m]);
  }

  const out: MapMarker[] = [];

  for (const [country, list] of byCountry) {
    const self = list.find((m) => m.countryLevel);
    const children = list.filter((m) => m !== self);

    // A country with a single place has nothing to expand into: the place is
    // the pin.
    if (list.length === 1) {
      const m = list[0];
      out.push({
        name: m.name,
        cx: m.cx,
        cy: m.cy,
        type: m.type,
        subtype: m.subtype,
        group: m.group,
        country,
        level: 1,
        rank: 0,
      });
      continue;
    }

    // Centre of the places, not of the capital that happens to carry the
    // country-level place's coordinate.
    const basis = children.length ? children : list;
    const cx = basis.reduce((s, m) => s + m.cx, 0) / basis.length;
    const cy = basis.reduce((s, m) => s + m.cy, 0) / basis.length;
    const places = children.slice(0, PREVIEW_PLACES).map((m) => m.name);

    if (self) {
      out.push({
        name: self.name,
        cx,
        cy,
        type: "poi",
        group: self.group ?? mostCommonGroup(list),
        country,
        level: 0,
        rank: 0,
        label: country,
        count: children.length,
        places,
      });
    } else {
      out.push({
        name: country,
        cx,
        cy,
        type: "poi",
        group: mostCommonGroup(list),
        country,
        level: 0,
        rank: 0,
        label: country,
        aggregate: true,
        count: children.length,
        places,
      });
    }

    children.forEach((m, i) => {
      out.push({
        name: m.name,
        cx: m.cx,
        cy: m.cy,
        type: m.type,
        subtype: m.subtype,
        group: m.group,
        country,
        level: 1,
        rank: i,
      });
    });
  }

  return out;
}
