/** Browser-only: saves the traveller's itinerary as a .json file. Lives outside @retro/core, which must stay free of DOM globals. */
import type { Quotation } from "@retro/core/atlas/engine/types";
import { buildTripItinerary } from "@retro/core/trip-export";

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
