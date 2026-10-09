import { describe, expect, it } from "vitest";
import {
  classifyViewport,
  closestPairPx,
  minSpacingPx,
  pinMetrics,
  selectVisiblePins,
  spacingPx,
  type DeclutterPin,
} from "@/lib/map-declutter";

function country(name: string, x: number, y: number): DeclutterPin {
  return { id: `c:${name}`, x, y, country: name, level: 0, rank: 0 };
}
function place(c: string, n: number, x: number, y: number, extra: Partial<DeclutterPin> = {}): DeclutterPin {
  return { id: `${c}:${n}`, x, y, country: c, level: 1, rank: n, ...extra };
}

/** A small seeded generator so the "random" maps below are repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function crowdedMap(seed: number, countries = 12, perCountry = 15): DeclutterPin[] {
  const r = rng(seed);
  const pins: DeclutterPin[] = [];
  for (let c = 0; c < countries; c++) {
    const cx = 60 + r() * 480;
    const cy = 60 + r() * 480;
    const name = `Country${c}`;
    const members: DeclutterPin[] = [];
    for (let i = 0; i < perCountry; i++) {
      members.push(place(name, i, cx + (r() - 0.5) * 60, cy + (r() - 0.5) * 60));
    }
    pins.push(...members);
    pins.push(country(name, cx, cy));
  }
  return pins;
}

const drawn = (pins: DeclutterPin[], visible: Set<string>) => pins.filter((p) => visible.has(p.id));

describe("viewport rules", () => {
  it("classifies screens by width", () => {
    expect(classifyViewport(390)).toBe("phone");
    expect(classifyViewport(820)).toBe("tablet");
    expect(classifyViewport(1440)).toBe("desktop");
  });

  it("asks for fewer pins per screenful on smaller screens", () => {
    expect(pinMetrics(390).targetPins).toBeLessThan(pinMetrics(820).targetPins);
    expect(pinMetrics(820).targetPins).toBeLessThan(pinMetrics(1440).targetPins);
  });

  it("never lets spacing fall below one pin diameter plus the gap", () => {
    for (const width of [360, 820, 1440]) {
      const hard = minSpacingPx(pinMetrics(width));
      for (const zoom of [1, 3, 6, 20, 40]) {
        expect(spacingPx(width, 600, zoom)).toBeGreaterThanOrEqual(hard);
      }
    }
  });

  it("relaxes spacing as the map is zoomed in", () => {
    expect(spacingPx(1200, 600, 1)).toBeGreaterThan(spacingPx(1200, 600, 3));
    expect(spacingPx(1200, 600, 3)).toBeGreaterThan(spacingPx(1200, 600, 6));
  });
});

describe("selectVisiblePins", () => {
  it("never draws two pins closer than the enforced spacing — at any size or zoom", () => {
    for (const seed of [1, 7, 42, 99]) {
      const pins = crowdedMap(seed);
      for (const width of [360, 820, 1440]) {
        for (const zoom of [1, 2, 4, 8, 20]) {
          const pxPerUnit = (width / 600) * zoom;
          const result = selectVisiblePins({ pins, pxPerUnit, widthPx: width, heightPx: 500, zoom });
          const pairs = closestPairPx(drawn(pins, result.visible), pxPerUnit);
          expect(pairs).toBeGreaterThanOrEqual(result.spacingPx - 1e-6);
        }
      }
    }
  });

  it("shows country pins when zoomed out and places once there is room", () => {
    const pins = crowdedMap(5);
    const zoomedOut = selectVisiblePins({ pins, pxPerUnit: 1, widthPx: 600, heightPx: 500, zoom: 1 });
    const out = drawn(pins, zoomedOut.visible);
    expect(out.filter((p) => p.level === 0).length).toBeGreaterThan(0);

    const zoomedIn = selectVisiblePins({ pins, pxPerUnit: 30, widthPx: 600, heightPx: 500, zoom: 30 });
    const inn = drawn(pins, zoomedIn.visible);
    expect(inn.filter((p) => p.level === 1).length).toBeGreaterThan(out.filter((p) => p.level === 1).length);
  });

  it("draws fewer pins on a phone than on a desktop for the same map", () => {
    const pins = crowdedMap(3);
    const phone = selectVisiblePins({ pins, pxPerUnit: 0.6, widthPx: 360, heightPx: 320, zoom: 1 });
    const desktop = selectVisiblePins({ pins, pxPerUnit: 1.8, widthPx: 1280, heightPx: 640, zoom: 1 });
    expect(phone.visible.size).toBeLessThanOrEqual(desktop.visible.size);
  });

  it("replaces a country's pin with its places, never showing both", () => {
    const pins = crowdedMap(11, 6, 6);
    const r = selectVisiblePins({ pins, pxPerUnit: 8, widthPx: 1280, heightPx: 640, zoom: 8 });
    for (const c of r.expanded) {
      expect(r.visible.has(`c:${c}`)).toBe(false);
    }
    for (const p of pins.filter((x) => x.level === 0)) {
      if (r.visible.has(p.id)) {
        const siblings = pins.filter((x) => x.level === 1 && x.country === p.country);
        expect(siblings.some((s) => r.visible.has(s.id))).toBe(false);
      }
    }
  });

  it("does not depend on where the map is panned", () => {
    const pins = crowdedMap(21);
    const a = selectVisiblePins({ pins, pxPerUnit: 4, widthPx: 1000, heightPx: 500, zoom: 4 });
    const b = selectVisiblePins({ pins: [...pins].reverse(), pxPerUnit: 4, widthPx: 1000, heightPx: 500, zoom: 4 });
    expect([...a.visible].sort()).toEqual([...b.visible].sort());
  });

  it("gives every country's best place its turn before any country's second", () => {
    const pins = [
      country("A", 100, 100),
      place("A", 0, 100, 100),
      place("A", 1, 112, 100),
      country("B", 130, 100),
      place("B", 0, 130, 100),
      place("B", 1, 142, 100),
    ];
    const r = selectVisiblePins({ pins, pxPerUnit: 3, widthPx: 1280, heightPx: 640, zoom: 20 });
    expect(r.visible.has("A:0")).toBe(true);
    expect(r.visible.has("B:0")).toBe(true);
  });

  it("always keeps a pinned place, such as one the traveller already selected", () => {
    const pins = [
      country("A", 100, 100),
      place("A", 0, 100, 100),
      place("A", 1, 101, 100, { pinned: true }),
    ];
    const r = selectVisiblePins({ pins, pxPerUnit: 1, widthPx: 1280, heightPx: 640, zoom: 1 });
    expect(r.visible.has("A:1")).toBe(true);
  });

  it("shows a one-place country's place directly", () => {
    const pins = [place("Solo", 0, 200, 200)];
    const r = selectVisiblePins({ pins, pxPerUnit: 1, widthPx: 1280, heightPx: 640, zoom: 1 });
    expect(r.visible.has("Solo:0")).toBe(true);
  });
});

import { placePinLabels } from "@/lib/map-declutter";

describe("placePinLabels", () => {
  it("never lets a label cover another pin or another label", () => {
    const items = [
      { id: "a", px: 100, py: 100, text: "Alpha" },
      { id: "b", px: 150, py: 100, text: "Bravo" },
      { id: "c", px: 400, py: 300, text: "Charlie" },
    ];
    const sides = placePinLabels(items, 12);
    expect(sides.get("c")).toBe("right");
    // "a" cannot go right (its label would run into pin "b"), so it goes left.
    expect(sides.get("a")).toBe("left");
  });

  it("omits a label rather than overlap", () => {
    const items = [
      { id: "a", px: 100, py: 100, text: "A very long name indeed" },
      { id: "b", px: 60, py: 100, text: "Left" },
      { id: "c", px: 220, py: 100, text: "Right" },
    ];
    expect(placePinLabels(items, 12).has("a")).toBe(false);
  });
});

import { PLACE_ZOOM } from "@/lib/map-declutter";

describe("country-first disclosure", () => {
  it("shows only countries below the place zoom, however far apart the places are", () => {
    const pins = [
      country("A", 100, 100),
      place("A", 0, 20, 20),
      place("A", 1, 580, 580),
      place("A", 2, 20, 580),
    ];
    const r = selectVisiblePins({ pins, pxPerUnit: 3, widthPx: 1800, heightPx: 1800, zoom: PLACE_ZOOM - 0.2 });
    expect([...r.visible]).toEqual(["c:A"]);
    const z = selectVisiblePins({ pins, pxPerUnit: 3, widthPx: 1800, heightPx: 1800, zoom: PLACE_ZOOM + 0.5 });
    expect(z.visible.has("c:A")).toBe(false);
    expect(z.visible.has("A:0")).toBe(true);
  });
});
