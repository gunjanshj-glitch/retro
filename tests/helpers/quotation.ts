import type { Quotation } from "@/lib/atlas/engine/types";

/** Just enough of a Quotation for the commercial layer; the engine is not under test here. */
export function fakeQuotation(total = 100_000): Quotation {
  return {
    request: { startDate: "2030-01-10", hotelStar: "4 Star", mealPlan: "breakfast", includeFlight: false, includeVisa: true, includeInsurance: false, departureCity: "DEL" },
    stays: [{ placeId: "paris", placeName: "Paris", nights: 3, position: 0 }, { placeId: "rome", placeName: "Rome", nights: 2, position: 1 }],
    days: [
      { dayNumber: 1, date: "2030-01-10", placeId: "paris", placeName: "Paris", isTransferDay: false, transfer: null, activities: [{ title: "Louvre", hours: 3, clusterId: null, code: null, attractions: [], walkingIntensity: null, locked: false, pricePerPersonInr: 0 }] },
    ],
    lineItems: [
      { component: "hotel", label: "Hotel", totalInr: 50_000 },
      { component: "sightseeing", label: "Tickets", totalInr: 20_000 },
      { component: "meals", label: "Meals", totalInr: 10_000 },
    ],
    totals: { directCost: 80_000, contingency: 2_400, costBeforeMarkup: 82_400, agentMarkup: 9_888, salesVat: 5_000, paymentAndFx: 2_712, total, perPerson: total / 2, flooredToPackage: "secret" },
    pax: { adults: 2, children: 0, infants: 0, total: 2, rooms: 1 },
    warnings: [{ level: "info", audience: "internal", message: "internal margin note" }],
  } as unknown as Quotation;
}
