import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pinMetrics, placePinLabels, selectVisiblePins, type DeclutterPin } from "@retro/core/map-declutter";
import core from "../../public/atlas/core.json";

/**
 * Regression: Srinagar is picked at high zoom on India's map, where Gulmarg
 * (left) and Pahalgam (right) sit within a label's width of it. Both label
 * sides collide with a neighbouring pin, and the old placement dropped the
 * label altogether (a selected pin kept a dot but lost its name).
 */
describe("selected pins keep their label", () => {
  it("Srinagar is a catalogue place", () => {
    expect(core.places.some((p) => p.name === "Srinagar")).toBe(true);
  });

  const r = pinMetrics(1072).radiusPx;
  // Pixel offsets from Srinagar at 8x on India's map (from india.markers.json).
  const crowd = [
    { id: "Srinagar", px: 500, py: 300, text: "Srinagar" },
    { id: "Gulmarg", px: 450, py: 305, text: "Gulmarg" },
    { id: "Pahalgam", px: 565, py: 308, text: "Pahalgam" },
    { id: "Sonmarg", px: 561, py: 267, text: "Sonmarg" },
  ];

  it("gives a required label a side even when both sides are blocked", () => {
    const sides = placePinLabels(
      crowd.map((c) => ({ ...c, required: c.id === "Srinagar" })),
      r,
    );
    expect(sides.has("Srinagar")).toBe(true);
  });

  it("unrequired crowded labels are still dropped, and never displace a required one", () => {
    const plain = placePinLabels(crowd, r);
    expect(plain.has("Srinagar")).toBe(false);
    const sides = placePinLabels(crowd.slice().reverse().map((c) => ({ ...c, required: c.id === "Srinagar" })), r);
    expect(sides.has("Srinagar")).toBe(true);
  });

  const file = "public/maps/india.markers.json";
  it.skipIf(!existsSync(file))("holds with the real India marker data at every zoom", () => {
    const m = JSON.parse(readFileSync(file, "utf8")) as {
      viewBox: number[];
      markers: { name: string; cx: number; cy: number; level: 0 | 1; rank: number; country: string; aggregate?: boolean }[];
    };
    const names = new Set(core.places.map((p) => p.name.toLowerCase()));
    const [, , vw, vh] = m.viewBox;
    const W = 1072;
    const H = 557;
    for (const zoom of [1, 1.6, 2, 3, 4, 6, 8]) {
      const pxPerUnit = Math.min(W / (vw / zoom), H / (vh / zoom));
      const pins: DeclutterPin[] = m.markers
        .filter((k) => names.has(k.name.toLowerCase()) || (k.level === 0 && k.aggregate))
        .map((k) => ({ id: `${k.level}:${k.name}`, x: k.cx, y: k.cy, country: k.country, level: k.level, rank: k.rank, pinned: k.name === "Srinagar" && k.level === 1 }));
      const vis = selectVisiblePins({ pins, pxPerUnit, widthPx: W, heightPx: H, zoom });
      const shown = pins.filter((p) => vis.visible.has(p.id));
      const sri = shown.find((p) => p.id === "1:Srinagar")!;
      expect(sri, `Srinagar drawn at ${zoom}x`).toBeDefined();
      const sides = placePinLabels(
        shown.map((p) => ({ id: p.id, px: (p.x - sri.x) * pxPerUnit, py: (p.y - sri.y) * pxPerUnit, text: p.id.slice(2), required: p.pinned })),
        pinMetrics(W).radiusPx,
      );
      expect(sides.has(sri.id), `Srinagar labelled at ${zoom}x`).toBe(true);
    }
  });
});
