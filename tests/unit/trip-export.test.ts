import { describe, expect, it } from "vitest";
import { buildTripItinerary } from "@retro/core/trip-export";
import type { Quotation } from "@retro/core/atlas/engine/types";

const q = {
  request: { startDate: "2026-12-01", nights: 2 },
  pax: { adults: 2, children: 0, infants: 0, total: 2, rooms: 1 },
  stays: [{ placeId: "p", placeName: "Paris", nights: 2, position: 0 }],
  days: [{ dayNumber: 1, placeId: "p", date: "2026-12-01", placeName: "Paris", transfer: { from: "A", to: "Paris", mode: "flight", durationMinutes: 60, via: [], priceInr: 100 },
    activities: [{ title: "Louvre", hours: 3, locked: false, attractions: ["Mona Lisa"], pricePerPersonInr: 50 }], meals: {}, notes: [] }],
  lineItems: [{ component: "hotel", label: "Hotel", detail: "", quantity: 2, unit: "night", unitPriceInr: 10, totalInr: 20 }],
  totals: { total: 1000, perPerson: 500, agentMarkup: 99 },
} as unknown as Quotation;

describe("buildTripItinerary", () => {
  it("has places, transport, attractions and cost, without markup", () => {
    const out = buildTripItinerary(q, { requestId: "x" });
    expect(out.places[0].name).toBe("Paris");
    expect(out.days[0].transport?.mode).toBe("flight");
    expect(out.days[0].attractions[0].title).toBe("Louvre");
    expect(out.places[0].attractions[0].title).toBe("Louvre");
    expect(out.cost.total).toBe(1000);
    expect(JSON.stringify(out)).not.toContain("agentMarkup");
  });
});
