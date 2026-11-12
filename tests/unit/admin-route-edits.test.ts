import { describe, expect, it } from "vitest";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import {
  MAX_TRIP_NIGHTS, addStop, canPlaceOnDay, freeze, hasSplitVisit, keepLegModes, moveStop, nightsMismatch,
  placeOuting, removeStop, resetRoute, setOutingOn, setStopNights, stopsOf,
} from "@/components/admin/route-edits";

const base = (over: Partial<QuoteRequest> = {}) =>
  QuoteRequest.parse({
    placeIds: ["a", "b", "c"], nights: 6, startDate: "2030-01-10", adults: 2, childAges: [],
    travellerType: "couple", tripStyle: "culture", nationality: "IND", departureCity: "DEL",
    hotelStar: "3 Star", hotelZone: "Outskirts", carrier: "LCC", cabin: "Economy", mealPlan: "breakfast",
    food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: false, includeFlight: false, ...over,
  });
const quote = (stays: [string, number][]) => ({ stays: stays.map(([placeId, nights], position) => ({ placeId, placeName: placeId.toUpperCase(), nights, position })) }) as never;
const ids = (r: QuoteRequest) => r.placeOrder;

describe("route edits", () => {
  const r = base();
  const stops = stopsOf(quote([["a", 2], ["b", 2], ["c", 2]]), r);

  it("freezing writes order, nights and the matching total", () => {
    const f = freeze(r, stops);
    expect(ids(f)).toEqual(["a", "b", "c"]);
    expect(f.nightOverrides).toEqual({ a: 2, b: 2, c: 2 });
    expect(f.nights).toBe(6);
  });

  it("moves a stop to any position, in both directions", () => {
    expect(ids(moveStop(r, stops, 0, 2).request)).toEqual(["b", "c", "a"]);
    expect(ids(moveStop(r, stops, 2, 0).request)).toEqual(["c", "a", "b"]);
    expect(ids(moveStop(r, stops, 1, 0).request)).toEqual(["b", "a", "c"]);
  });

  it("ignores impossible moves", () => {
    expect(moveStop(r, stops, 1, 1).request).toBe(r);
    expect(moveStop(r, stops, 0, 9).request).toBe(r);
    expect(moveStop(r, stops, -1, 0).request).toBe(r);
  });

  it("changes nights and the trip length together, within 1..max", () => {
    const up = setStopNights(r, stops, "b", 5);
    expect(up.nightOverrides.b).toBe(5);
    expect(up.nights).toBe(9);
    expect(setStopNights(r, stops, "b", 0)).toBe(r);
    expect(setStopNights(r, stops, "b", MAX_TRIP_NIGHTS)).toBe(r);
    expect(setStopNights(r, stops, "zzz", 3)).toBe(r);
  });

  it("removes a stop, shrinks the trip, and refuses to remove the last", () => {
    const out = removeStop(r, stops, "b").request;
    expect(out.placeIds).toEqual(["a", "c"]);
    expect(out.nights).toBe(4);
    expect(out.nightOverrides).toEqual({ a: 2, c: 2 });
    const one = stopsOf(quote([["a", 2]]), base({ placeIds: ["a"], nights: 2 }));
    expect(removeStop(base({ placeIds: ["a"], nights: 2 }), one, "a").request.placeIds).toEqual(["a"]);
  });

  it("removing a stop also removes only that place's outings", () => {
    const withPins = base({ pinnedClusterIds: ["b:cluster:fort", "a:cluster:fort", "b2:cluster:fort"], excludedClusterIds: ["b:cluster:lake"], clusterDays: { "b:cluster:fort": 3, "a:cluster:fort": 1 } });
    const out = removeStop(withPins, stops, "b").request;
    expect(out.pinnedClusterIds).toEqual(["a:cluster:fort", "b2:cluster:fort"]);
    expect(out.excludedClusterIds).toEqual([]);
    expect(out.clusterDays).toEqual({ "a:cluster:fort": 1 });
  });

  it("adds a stop at a position with default nights, and not twice", () => {
    const added = addStop(r, stops, "d", "D", 1).request;
    expect(ids(added)).toEqual(["a", "d", "b", "c"]);
    expect(added.nightOverrides.d).toBe(2);
    expect(added.nights).toBe(8);
    expect(addStop(added, stopsOf(quote([["a", 2], ["d", 2], ["b", 2], ["c", 2]]), added), "d", "D").request).toBe(added);
  });

  it("will not add a stop past the maximum trip length", () => {
    const long = stopsOf(quote([["a", MAX_TRIP_NIGHTS]]), base({ placeIds: ["a"], nights: MAX_TRIP_NIGHTS }));
    const full = base({ placeIds: ["a"], nights: MAX_TRIP_NIGHTS });
    expect(addStop(full, long, "b", "B").request).toBe(full);
  });

  it("leaves a planner-added airport night alone and out of the request", () => {
    const withPort = stopsOf(quote([["port", 1], ["a", 2], ["b", 2], ["c", 2]]), r);
    expect(withPort.map((s) => s.chosen)).toEqual([false, true, true, true]);
    const moved = moveStop(r, withPort, 0, 2).request; // first *chosen* stop, not the airport night
    expect(ids(moved)).toEqual(["b", "c", "a"]);
    expect(moved.placeIds).toEqual(["b", "c", "a"]);
    expect(moved.nights).toBe(6);
    expect(moved.nightOverrides.port).toBeUndefined();
  });

  it("merges a place visited at both ends into one stop", () => {
    const q = quote([["a", 1], ["b", 3], ["a", 1]]);
    expect(stopsOf(q, base({ placeIds: ["a", "b"], nights: 5 })).map((s) => [s.placeId, s.nights])).toEqual([["a", 2], ["b", 3]]);
    expect(hasSplitVisit(q)).toBe(true);
    expect(hasSplitVisit(quote([["a", 1], ["b", 1]]))).toBe(false);
  });

  it("resets to the planner without touching the stops", () => {
    const edited = moveStop(r, stops, 0, 2).request;
    const back = resetRoute(edited);
    expect(back.placeOrder).toEqual([]);
    expect(back.nightOverrides).toEqual({});
    expect(back.placeIds).toEqual(edited.placeIds);
  });

  it("flags a trip length that disagrees with the stops", () => {
    expect(nightsMismatch(base({ nights: 6 }), stops)).toBeNull();
    expect(nightsMismatch(base({ nights: 9 }), stops)).toEqual({ requested: 9, route: 6 });
  });
});

describe("a place the planner left out", () => {
  // "x" is in the request but the engine dropped it (e.g. not combinable with the rest of the trip).
  const r = base({ placeIds: ["a", "b", "x"], nights: 4, nightOverrides: { a: 2, b: 2 } });
  const stops = stopsOf(quote([["a", 2], ["b", 2]]), r, (id) => id.toUpperCase());

  it("is listed as dropped, with no nights, and does not count towards the trip length", () => {
    const x = stops.find((s) => s.placeId === "x")!;
    expect(x).toMatchObject({ dropped: true, nights: 0, chosen: true, name: "X" });
    expect(nightsMismatch(r, stops)).toBeNull();
  });

  it("keeps ordering and nights working on the real stops, and keeps it in the request until removed", () => {
    const moved = moveStop(r, stops, 0, 1).request;
    expect(moved.placeOrder).toEqual(["b", "a"]);
    expect(moved.placeIds).toEqual(["b", "a", "x"]);
    expect(moved.nightOverrides).toEqual({ a: 2, b: 2 });
    expect(setStopNights(r, stops, "a", 3).placeIds).toEqual(["a", "b", "x"]);
  });

  it("can be removed even though it is not an itinerary stop, and does not shorten the trip", () => {
    const out = removeStop(r, stops, "x").request;
    expect(out.placeIds).toEqual(["a", "b"]);
    expect(out.nights).toBe(4);
  });

  it("stays out when another place is added", () => {
    const added = addStop(r, stops, "d", "D").request;
    expect(added.placeIds).toEqual(["a", "b", "d", "x"]);
    expect(added.nights).toBe(6);
  });

  it("is not added twice", () => {
    expect(addStop(r, stops, "x", "X").request).toBe(r);
  });
});

describe("transport pins follow their hop", () => {
  it("keeps a pin whose hop is unchanged and drops one whose neighbour changed", () => {
    const pins = { b: "train", c: "flight" } as QuoteRequest["legModes"];
    // a>b>c → a>b>c: nothing changes
    expect(keepLegModes(pins, ["a", "b", "c"], ["a", "b", "c"]).legModes).toEqual(pins);
    // a>b>c → b>a>c: b now has no predecessor, c arrives from a not b
    const r = keepLegModes(pins, ["a", "b", "c"], ["b", "a", "c"]);
    expect(r.legModes).toEqual({});
    expect(r.dropped).toBe(2);
    // a>b>c → a>b>d>c style insertion after c keeps b's hop
    const kept = keepLegModes(pins, ["a", "b", "c"], ["a", "b", "c", "d"]);
    expect(kept.legModes).toEqual(pins);
  });

  it("keeps airport-link pins, which belong to a place and not to its neighbour", () => {
    const pins = { "a:to-airport": "taxi" } as unknown as QuoteRequest["legModes"];
    expect(keepLegModes(pins, ["a", "b"], ["b", "a"]).legModes).toEqual(pins);
  });

  it("reordering through moveStop reports how many pins were dropped", () => {
    const r = base({ legModes: { b: "train" } as never });
    const stops = stopsOf(quote([["a", 2], ["b", 2], ["c", 2]]), r);
    const out = moveStop(r, stops, 1, 0);
    expect(out.droppedLegPins).toBe(1);
    expect(out.request.legModes).toEqual({});
  });
});

describe("day plan edits", () => {
  const q = {
    days: [{ dayNumber: 1, placeId: "a" }, { dayNumber: 2, placeId: "a" }, { dayNumber: 3, placeId: "b" }],
    sightseeingOptions: [{ clusterId: "a:cluster:fort", placeId: "a", placeName: "A", title: "Fort", status: "planned" }, { clusterId: "a:cluster:lake", placeId: "a", placeName: "A", title: "Lake", status: "unscheduled" }],
  } as never;

  it("only lets an outing go on a day at its own destination", () => {
    expect(canPlaceOnDay(q, "a:cluster:fort", 2)).toEqual({ ok: true });
    const bad = canPlaceOnDay(q, "a:cluster:fort", 3);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toMatch(/Fort is in A.*move the A stop/);
    expect(canPlaceOnDay(q, "nope", 1).ok).toBe(false);
  });

  it("moving a planned outing does not pin it; adding one does, and clears a switch-off", () => {
    const r = base({ excludedClusterIds: ["a:cluster:lake"] });
    expect(placeOuting(r, "a:cluster:fort", 2, false).pinnedClusterIds).toEqual([]);
    const added = placeOuting(r, "a:cluster:lake", 1, true);
    expect(added.pinnedClusterIds).toEqual(["a:cluster:lake"]);
    expect(added.excludedClusterIds).toEqual([]);
    expect(added.clusterDays["a:cluster:lake"]).toBe(1);
  });

  it("switching off differs by mode: auto excludes, manual unpins", () => {
    const auto = base({ pinnedClusterIds: ["a:cluster:fort"] });
    const off = setOutingOn(auto, { clusterId: "a:cluster:fort", status: "planned" }, false);
    expect(off.excludedClusterIds).toEqual(["a:cluster:fort"]);
    expect(off.pinnedClusterIds).toEqual([]);
    const manual = base({ sightseeingMode: "manual", pinnedClusterIds: ["a:cluster:fort"] });
    expect(setOutingOn(manual, { clusterId: "a:cluster:fort", status: "planned" }, false).pinnedClusterIds).toEqual([]);
    expect(setOutingOn(manual, { clusterId: "a:cluster:lake", status: "unscheduled" }, true).pinnedClusterIds).toEqual(["a:cluster:fort", "a:cluster:lake"]);
  });
});
