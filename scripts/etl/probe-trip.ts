/** Ad-hoc: quote an arbitrary trip. `tsx scripts/etl/probe-trip.ts DEL 7 tawang,guwahati,dirang [fastest|balanced|cheapest]` */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import type { CoreBundle, DestinationBundle, Route, VisaRule } from "@retro/core/atlas/schema";

const OUT = path.join("public", "atlas");
const core = JSON.parse(readFileSync(path.join(OUT, "core.json"), "utf8")) as CoreBundle;
const routes = (JSON.parse(readFileSync(path.join(OUT, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(OUT, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;
const [from = "DEL", nightsArg = "7", list = "tawang", pref = "balanced"] = process.argv.slice(2);
const placeIds = list.split(",").map((q) => {
  const p = core.places.find((x) => x.id === q || x.name.toLowerCase() === q.toLowerCase());
  if (!p) throw new Error(`no place ${q}`);
  return p.id;
});
const bundles = new Map<string, DestinationBundle>();
for (const id of placeIds) {
  const f = path.join(OUT, "destinations", `${id}.json`);
  if (existsSync(f)) bundles.set(id, JSON.parse(readFileSync(f, "utf8")));
}
const request = QuoteRequest.parse({
  placeIds, nights: Number(nightsArg), startDate: "2026-12-05", adults: 2, childAges: [],
  travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: from,
  hotelStar: "3 Star", hotelZone: "Outskirts", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast",
  food: "no-preference", pace: "balanced", includeVisa: false, includeInsurance: false, includeFlight: true,
  transportPreference: pref,
});
const q = generateQuotation(request, { core, routes, visaRules, bundles, ignorePackageFloor: true });
console.log("STAYS", q.stays.map((s) => `${s.placeName}(${s.nights})`).join(" > "));
console.log("GATEWAYS", JSON.stringify(q.gateways && { arr: q.gateways.arrival.iata, dep: q.gateways.departure.iata }));
for (const d of q.days) {
  console.log(`D${d.dayNumber} ${d.placeName} budget=${d.budgetHours} act=${d.activeHours} ${d.transfer ? `[${d.transfer.from}->${d.transfer.to} ${d.transfer.mode} ${d.transfer.durationMinutes}m ₹${d.transfer.priceInr} alts=${d.transfer.alternatives.map((a) => a.mode).join("/")}]` : ""} ${d.notes.join("; ")}`);
}
for (const l of q.lineItems.filter((i) => ["flight", "intercity-transport", "ground-transport", "airport-transfer"].includes(i.component))) console.log("LINE", l.component, l.label, l.totalInr);
console.log("TOTAL", q.totals.total);
