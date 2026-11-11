import { describe, expect, it } from "vitest";
import { buildRoutePath, routeStops } from "@/lib/route-path";

const A = { cx: 0, cy: 0 };
const B = { cx: 100, cy: 0 };
const C = { cx: 100, cy: 100 };

describe("buildRoutePath", () => {
  it("draws nothing for zero or one stop", () => {
    expect(buildRoutePath([], { k: 1 }).segments).toEqual([]);
    const one = buildRoutePath([A], { k: 1 });
    expect(one.segments).toEqual([]);
    expect(one.d).toBe("");
  });

  it("joins consecutive stops in the given order", () => {
    const r = buildRoutePath([A, B, C], { k: 1 });
    expect(r.segments).toEqual([
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 100 },
    ]);
    expect(r.d).toBe("M0,0L100,0M100,0L100,100");
  });

  it("reconnects when a middle stop is removed", () => {
    const r = buildRoutePath([A, C], { k: 1 });
    expect(r.segments).toEqual([{ x1: 0, y1: 0, x2: 100, y2: 100 }]);
  });

  it("points arrowheads along the direction of travel, at each midpoint", () => {
    const r = buildRoutePath([A, B, C, A], { k: 1, minArrowPx: 0 });
    expect(r.arrows.map((a) => Math.round(a.angle))).toEqual([0, 90, -135]);
    expect(r.arrows[0]).toMatchObject({ x: 50, y: 0 });
  });

  it("trims both ends by a screen-px gap converted to map units", () => {
    const r = buildRoutePath([A, B], { k: 0.5, trimPx: 10 });
    expect(r.segments[0]).toEqual({ x1: 5, y1: 0, x2: 95, y2: 0 });
  });

  it("lifts stops by px * k so the line meets the pin bulb, not its tip", () => {
    const r = buildRoutePath([A, B], { k: 2, liftPx: 5 });
    expect(r.segments[0].y1).toBe(-10);
    expect(r.segments[0].y2).toBe(-10);
  });

  it("skips coincident stops and segments swallowed by trimming", () => {
    expect(buildRoutePath([A, { ...A }], { k: 1 }).segments).toEqual([]);
    expect(buildRoutePath([A, { cx: 5, cy: 0 }], { k: 1, trimPx: 5 }).segments).toEqual([]);
  });

  it("omits arrowheads on segments too short to hold one", () => {
    const r = buildRoutePath([A, { cx: 20, cy: 0 }], { k: 1, minArrowPx: 28 });
    expect(r.segments).toHaveLength(1);
    expect(r.arrows).toEqual([]);
  });

  it("ignores a non-positive scale and non-finite points", () => {
    expect(buildRoutePath([A, B], { k: 0 }).segments).toEqual([]);
    expect(buildRoutePath([A, { cx: NaN, cy: 0 }, B], { k: 1 }).segments).toEqual([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
  });
});

describe("routeStops", () => {
  const positions = new Map([
    ["a", A],
    ["b", B],
    ["c", C],
  ]);

  it("keeps pick order, not map order", () => {
    expect(routeStops(["c", "a", "b"], positions)).toEqual([C, A, B]);
  });

  it("skips places that are not on this map and duplicates", () => {
    expect(routeStops(["a", "elsewhere", "b", "a"], positions)).toEqual([A, B]);
  });
});
