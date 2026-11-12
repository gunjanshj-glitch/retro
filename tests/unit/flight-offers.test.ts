import { describe, expect, it } from "vitest";
import { flightOffers } from "../../workers/api/src/live-rates";

const leg = (dep: string, arr: string, airline = "IndiGo") => ({
  airline,
  departure_airport: { id: "DEL", time: dep },
  arrival_airport: { id: "GAU", time: arr },
});

describe("flightOffers", () => {
  it("reads clock times, orders by fare and drops duplicates and legs without times", () => {
    const out = flightOffers([
      { price: 9000, flights: [leg("2026-12-05 18:35", "2026-12-05 21:05")] },
      { price: 7000, flights: [leg("2026-12-05 06:15", "2026-12-05 08:35")] },
      { price: 7000, flights: [leg("2026-12-05 06:15", "2026-12-05 08:35")] },
      { price: 6000, flights: [{ airline: "X" }] },
      { price: 5000, flights: [leg("2026-12-05 23:00", "2026-12-06 01:30")] },
    ]);
    expect(out.map((o) => o.inr)).toEqual([5000, 7000, 9000]);
    expect(out[0]).toMatchObject({ departsMin: 23 * 60, arrivesMin: 90, arrivesDayOffset: 1 });
    expect(out[1]).toMatchObject({ arrivesMin: 8 * 60 + 35, arrivesDayOffset: 0, stops: 0, airline: "IndiGo" });
  });
});
