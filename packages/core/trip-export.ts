/**
 * The traveller's downloadable itinerary: places, transport, attractions and
 * cost, as plain JSON. Built from the same Quotation the planner shows, and
 * deliberately traveller-safe — no agency markup, margin or internal notes.
 */
import type { Quotation } from "./atlas/engine/types";

export function buildTripItinerary(quote: Quotation, meta: { requestId?: string; destinationSummary?: string } = {}) {
  const r = quote.request;
  return {
    requestId: meta.requestId ?? null,
    generatedAt: new Date().toISOString(),
    trip: {
      summary: meta.destinationSummary ?? quote.stays.map((s) => s.placeName).join(", "),
      startDate: r.startDate,
      nights: r.nights,
      travellers: quote.pax,
    },
    places: quote.stays.map((s, i) => {
      // A place visited twice appears twice in `stays`; list its attractions once, on the first visit.
      const first = quote.stays.findIndex((x) => x.placeId === s.placeId) === i;
      const seen = new Set<string>();
      const attractions = first
        ? quote.days
            .filter((d) => d.placeId === s.placeId)
            .flatMap((d) => d.activities.filter((a) => !a.locked))
            .filter((a) => !seen.has(a.title) && seen.add(a.title))
            .map((a) => ({ title: a.title, hours: a.hours, includes: a.attractions, costPerPersonInr: a.pricePerPersonInr }))
        : [];
      return { name: s.placeName, nights: s.nights, order: s.position + 1, attractions };
    }),
    days: quote.days.map((d) => ({
      day: d.dayNumber,
      date: d.date,
      place: d.placeName,
      transport: d.transfer
        ? {
            from: d.transfer.from,
            to: d.transfer.to,
            mode: d.transfer.mode,
            durationMinutes: d.transfer.durationMinutes,
            via: d.transfer.via,
            costPerPersonInr: d.transfer.priceInr,
          }
        : null,
      attractions: d.activities.map((a) => ({
        title: a.title,
        hours: a.hours,
        includes: a.attractions,
        costPerPersonInr: a.pricePerPersonInr,
      })),
      meals: d.meals,
      notes: d.notes,
    })),
    cost: {
      currency: "INR",
      total: quote.totals.total,
      perPerson: quote.totals.perPerson,
      lineItems: quote.lineItems.map((l) => ({
        category: l.component,
        label: l.label,
        detail: l.detail,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceInr: l.unitPriceInr,
        totalInr: l.totalInr,
      })),
    },
    note: "Estimate only. Our team will confirm every rate in your final quote.",
  };
}

/** Browser-only: saves the itinerary as a .json file (triggers the download). */
export function downloadTripItinerary(quote: Quotation, meta: { requestId?: string; destinationSummary?: string } = {}) {
  const data = JSON.stringify(buildTripItinerary(quote, meta), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `itinerary-${meta.requestId?.slice(0, 8) ?? "trip"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
