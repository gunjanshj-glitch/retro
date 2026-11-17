import { describe, expect, it } from "vitest";
import {
  EXHAUSTIVE_MAX, OBJECTIVE_HOUR_VALUE_INR, OPEN_JAW_PREMIUM, bestPerObjective, candidateOrders, costOfOrder,
  moveInOrder, planRoutes, rankRoutes, reverseOrder, shuffledOrder,
  type HopCost, type PlanStop, type RoutePlanInput,
} from "@retro/core/atlas/engine/routeplan";

/** Stops on a line: a hop costs 10 INR and 1 minute per kilometre. */
const onLine = (km: Record<string, number>) => (a: string, b: string): HopCost => ({
  inr: Math.abs(km[a] - km[b]) * 10,
  minutes: Math.abs(km[a] - km[b]),
});

const stop = (id: string, airport: string | null = id, nights = 3): PlanStop => ({ id, nights, airport });
const input = (stops: PlanStop[], hop: RoutePlanInput["hop"], fare = 40_000, extra: Partial<RoutePlanInput> = {}): RoutePlanInput => ({
  stops, hop, roundTripInr: () => fare, ...extra,
});

describe("route planner: the plans it considers", () => {
  it("has no plan for an empty trip and exactly one for a single stop", () => {
    expect(planRoutes(input([], onLine({})))).toEqual([]);
    const one = planRoutes(input([stop("a")], onLine({ a: 0 })));
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ order: ["a"], returnVia: null, openJaw: false, groundInr: 0, groundMinutes: 0, totalInr: 40_000 });
  });

  it("scores every order of the stops", () => {
    const stops = [stop("a"), stop("b"), stop("c")];
    const plans = planRoutes(input(stops, onLine({ a: 0, b: 10, c: 20 }), 40_000, { allowReturnVia: false }));
    expect(new Set(plans.map((p) => p.order.join(">"))).size).toBe(6);
    expect(plans).toHaveLength(6);
  });

  it("adds the plans that double back to an earlier stop for the flight home", () => {
    const stops = [stop("a"), stop("b"), stop("c")];
    const plans = planRoutes(input(stops, onLine({ a: 0, b: 10, c: 20 })));
    // 6 orders, each with returns to the 2 earlier stops: 6 + 12.
    expect(plans).toHaveLength(18);
    expect(plans.filter((p) => p.returnVia).every((p) => p.order.includes(p.returnVia!))).toBe(true);
  });

  it("will not double back to a stop with only one night to give", () => {
    const stops = [stop("a", "a", 1), stop("b"), stop("c")];
    const plans = planRoutes(input(stops, onLine({ a: 0, b: 10, c: 20 })));
    expect(plans.some((p) => p.returnVia === "a")).toBe(false);
  });

  it("does not offer a return to an airport the trip already ends at", () => {
    const stops = [stop("a", "X"), stop("b", "Y"), stop("c", "X")];
    const plans = planRoutes(input(stops, onLine({ a: 0, b: 10, c: 20 })));
    for (const p of plans.filter((p) => p.returnVia)) {
      const end = stops.find((s) => s.id === p.order[p.order.length - 1])!;
      const via = stops.find((s) => s.id === p.returnVia)!;
      expect(via.airport).not.toBe(end.airport);
    }
  });

  it("can fix where the trip lands", () => {
    const stops = [stop("a"), stop("b"), stop("c")];
    const plans = planRoutes(input(stops, onLine({ a: 0, b: 10, c: 20 }), 40_000, { fixedFirst: "b" }));
    expect(plans.every((p) => p.order[0] === "b")).toBe(true);
  });
});

describe("route planner: where the trip flies in and out", () => {
  it("prices a return from one airport below an open-jaw ticket", () => {
    const stops = [stop("a"), stop("b")];
    const plans = planRoutes(input(stops, onLine({ a: 0, b: 10 })));
    const same = plans.find((p) => p.returnVia && !p.openJaw)!;
    const jaw = plans.find((p) => !p.returnVia)!;
    expect(same.flightInr).toBe(40_000);
    expect(jaw.openJaw).toBe(true);
    expect(jaw.flightInr).toBe(Math.round(40_000 * (1 + OPEN_JAW_PREMIUM)));
  });

  it("averages the two fares of an open-jaw ticket", () => {
    const stops = [stop("a"), stop("b")];
    const fares: Record<string, number> = { a: 30_000, b: 50_000 };
    const plans = planRoutes({ stops, hop: onLine({ a: 0, b: 10 }), roundTripInr: (id) => fares[id] }, "cheapest");
    const jaw = plans.find((p) => p.order.join() === "a,b" && !p.returnVia)!;
    expect(jaw.flightInr).toBe(Math.round(40_000 * (1 + OPEN_JAW_PREMIUM)));
  });

  it("returns to the first stop when the places are close together", () => {
    // A, B and C within a short hop of each other: the cost of getting back is less than the open-jaw premium.
    const stops = [stop("a"), stop("b"), stop("c")];
    const hop = onLine({ a: 0, b: 20, c: 40 }); // 200 INR and 20 min per hop
    const best = planRoutes(input(stops, hop), "cheapest")[0];
    expect(best.returnVia).not.toBeNull();
    expect(best.openJaw).toBe(false);
    expect(best.entryAirport).toBe(best.exitAirport);
  });

  it("flies home from the last stop when going back would cost more than it saves", () => {
    const stops = [stop("a"), stop("b"), stop("c")];
    const hop = onLine({ a: 0, b: 1500, c: 3000 }); // 15,000 INR a hop, a full day each way
    for (const objective of ["cheapest", "balanced", "fastest"] as const) {
      const best = planRoutes(input(stops, hop), objective)[0];
      expect(best.returnVia).toBeNull();
      expect(best.openJaw).toBe(true);
    }
  });

  it("treats two stops that share an airport as one return ticket", () => {
    const stops = [stop("a", "X"), stop("b", "Y"), stop("c", "X")];
    const plan = planRoutes(input(stops, onLine({ a: 0, b: 10, c: 20 })), "cheapest").find((p) => p.order.join() === "a,b,c" && !p.returnVia)!;
    expect(plan.openJaw).toBe(false);
    expect(plan.flightInr).toBe(40_000);
  });

  it("falls back to the stop itself when it has no airport", () => {
    const plans = planRoutes(input([stop("a", null), stop("b", null)], onLine({ a: 0, b: 10 })));
    expect(plans.every((p) => p.entryAirport === p.order[0])).toBe(true);
  });
});

describe("route planner: sorting by objective", () => {
  // One airport throughout so flights never differ; the orders differ only in their ground cost.
  const stops = [stop("a", "X"), stop("b", "X"), stop("c", "X")];
  const table: Record<string, HopCost> = {
    "a|b": { inr: 200, minutes: 600 }, // cheap and slow
    "b|c": { inr: 200, minutes: 600 },
    "a|c": { inr: 3000, minutes: 60 }, // quick and dear
  };
  const hop = (x: string, y: string) => table[`${x}|${y}`] ?? table[`${y}|${x}`];
  const plans = (o: "cheapest" | "balanced" | "fastest") => planRoutes(input(stops, hop), o);

  it("puts the cheap, slow route first when only price matters", () => {
    expect(plans("cheapest")[0].order.join(">")).toMatch(/^(a>b>c|c>b>a)$/);
  });

  it("puts the quick route first when time is dear", () => {
    const best = plans("fastest")[0];
    expect(best.groundMinutes).toBe(660);
    expect(best.order.join(">")).not.toMatch(/^(a>b>c|c>b>a)$/);
  });

  it("is monotone: the more time is worth, the less time the best plan takes", () => {
    const m = (o: "cheapest" | "balanced" | "fastest") => plans(o)[0].groundMinutes;
    expect(m("cheapest")).toBeGreaterThanOrEqual(m("balanced"));
    expect(m("balanced")).toBeGreaterThanOrEqual(m("fastest"));
  });

  it("names the best plan for each objective", () => {
    const best = bestPerObjective(plans("balanced"));
    expect(best.cheapest!.totalInr).toBeLessThanOrEqual(best.fastest!.totalInr);
    expect(best.fastest!.groundMinutes).toBeLessThanOrEqual(best.cheapest!.groundMinutes);
  });

  it("scores a plan as price plus time at the objective's rate", () => {
    for (const o of ["cheapest", "balanced", "fastest"] as const) {
      for (const p of plans(o)) expect(p.score).toBeCloseTo(p.totalInr + (p.groundMinutes / 60) * OBJECTIVE_HOUR_VALUE_INR[o] + p.penalty, 5);
    }
  });

  it("marks the plans no other plan beats on both price and time", () => {
    const list = plans("balanced");
    const pareto = list.filter((p) => p.pareto);
    expect(pareto.length).toBeGreaterThan(0);
    for (const p of pareto) {
      expect(list.some((q) => q.totalInr < p.totalInr && q.groundMinutes < p.groundMinutes)).toBe(false);
    }
    // Both extremes are on the frontier.
    expect(pareto.some((p) => p.totalInr === Math.min(...list.map((q) => q.totalInr)))).toBe(true);
    expect(pareto.some((p) => p.groundMinutes === Math.min(...list.map((q) => q.groundMinutes)))).toBe(true);
  });

  it("is deterministic, ties included", () => {
    const flat = input([stop("a", "X"), stop("b", "X"), stop("c", "X")], () => ({ inr: 100, minutes: 60 }));
    const first = planRoutes(flat).map((p) => p.id);
    expect(planRoutes(flat).map((p) => p.id)).toEqual(first);
    const shuffled = planRoutes({ ...flat, stops: [...flat.stops].reverse() }).map((p) => p.id);
    expect(shuffled).toEqual(first);
  });

  it("re-ranks without changing any plan's price", () => {
    const a = plans("cheapest");
    const b = rankRoutes(a, "fastest");
    expect(new Map(a.map((p) => [p.id, p.totalInr]))).toEqual(new Map(b.map((p) => [p.id, p.totalInr])));
  });
});

describe("route planner: preferences that are not money or time", () => {
  it("counts a penalty against a plan's score but not its price", () => {
    const stops = [stop("a", "X"), stop("b", "X")];
    const hop = onLine({ a: 0, b: 10 });
    const plain = planRoutes(input(stops, hop), "cheapest");
    // a and b are mirror images, so a penalty on one order decides between them.
    const penalised = planRoutes(
      input(stops, hop, 40_000, { allowReturnVia: false, penalty: (order) => (order[0] === "a" ? 5_000 : 0) }),
      "cheapest",
    );
    expect(plain.find((p) => p.id === "a>b")!.totalInr).toBe(penalised.find((p) => p.id === "a>b")!.totalInr);
    expect(penalised[0].order[0]).toBe("b");
    expect(penalised.find((p) => p.id === "a>b")!.penalty).toBe(5_000);
  });
});

describe("route planner: larger trips", () => {
  const ids = Array.from({ length: EXHAUSTIVE_MAX + 3 }, (_, i) => `s${String(i).padStart(2, "0")}`);
  const km: Record<string, number> = Object.fromEntries(ids.map((id, i) => [id, ((i * 7) % ids.length) * 50]));

  it("searches every order up to the exhaustive limit", () => {
    const small = ids.slice(0, EXHAUSTIVE_MAX);
    expect(candidateOrders(small, onLine(km))).toHaveLength(Array.from({ length: EXHAUSTIVE_MAX }, (_, i) => i + 1).reduce((a, b) => a * b, 1));
  });

  it("beyond that, still returns whole tours that visit every stop once, and finds the straight run along a line", () => {
    const stops = ids.map((id) => stop(id, "X"));
    const plans = planRoutes(input(stops, onLine(km), 40_000, { allowReturnVia: false }), "cheapest");
    for (const p of plans) expect([...p.order].sort()).toEqual([...ids].sort());
    const span = Math.max(...Object.values(km)) - Math.min(...Object.values(km));
    expect(plans[0].groundMinutes).toBe(span);
  });

  it("does so quickly", () => {
    const stops = ids.map((id) => stop(id));
    const t = Date.now();
    planRoutes(input(stops, onLine(km)), "balanced");
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe("editing a route by hand", () => {
  it("moves a stop the way a drag in a list does", () => {
    expect(moveInOrder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveInOrder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveInOrder(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("ignores a move outside the list and never changes the original", () => {
    const o = ["a", "b"];
    expect(moveInOrder(o, 0, 5)).toEqual(["a", "b"]);
    expect(moveInOrder(o, -1, 0)).toEqual(["a", "b"]);
    moveInOrder(o, 0, 1);
    expect(o).toEqual(["a", "b"]);
  });

  it("reverses without touching the original", () => {
    const o = ["a", "b", "c"];
    expect(reverseOrder(o)).toEqual(["c", "b", "a"]);
    expect(o).toEqual(["a", "b", "c"]);
  });

  it("shuffles into a permutation, reproducibly for a fixed random source", () => {
    const o = ["a", "b", "c", "d", "e"];
    const seeded = () => {
      let x = 0.37;
      return () => (x = (x * 9301 + 0.49297) % 1);
    };
    const s1 = shuffledOrder(o, seeded());
    expect([...s1].sort()).toEqual(o);
    expect(shuffledOrder(o, seeded())).toEqual(s1);
    expect(o).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("prices a hand-made order on the same footing as the planner's own plans", () => {
    const stops = [stop("a"), stop("b"), stop("c")];
    const inp = input(stops, onLine({ a: 0, b: 10, c: 20 }));
    const planned = planRoutes(inp, "balanced");
    for (const p of planned.filter((x) => x.order.join() === "c,a,b")) {
      const mine = costOfOrder(inp, ["c", "a", "b"], "balanced", p.returnVia)!;
      expect(mine.totalInr).toBe(p.totalInr);
      expect(mine.score).toBeCloseTo(p.score, 5);
    }
  });

  it("is never cheaper than the best plan the planner found", () => {
    const stops = [stop("a"), stop("b"), stop("c")];
    const inp = input(stops, onLine({ a: 0, b: 30, c: 5 }));
    const best = planRoutes(inp, "balanced")[0];
    for (const order of [["a", "b", "c"], ["b", "a", "c"], ["c", "b", "a"]]) {
      expect(costOfOrder(inp, order, "balanced")!.score).toBeGreaterThanOrEqual(best.score - 1e-9);
    }
  });

  it("returns nothing for an order with no known stops", () => {
    expect(costOfOrder(input([stop("a")], onLine({ a: 0 })), ["z"])).toBeNull();
    expect(costOfOrder(input([stop("a")], onLine({ a: 0 })), [])).toBeNull();
  });
});
