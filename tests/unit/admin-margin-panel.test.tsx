import { afterEach, describe, expect, it, vi } from "vitest";
import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { emptyAdjustments, summariseMargin, type QuoteAdjustments } from "@retro/core/quote-pricing";
import { MarginPanel } from "@/components/admin/MarginPanel";
import { PriceSplitPanel } from "@/components/admin/PriceSplitPanel";
import { loadFlightLiveRates } from "@/lib/atlas/client";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

const bundles = new Map<string, DestinationBundle>();
for (const id of ["ha-noi"]) {
  const place = core.places.find((p) => p.id === id)!;
  bundles.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8")));
}

const initial = QuoteRequest.parse({
  placeIds: ["ha-noi"], nights: 4, startDate: "2026-11-15", adults: 2, childAges: [], travellerType: "couple", tripStyle: "romantic",
  nationality: "IND", departureCity: "DEL", hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy",
  mealPlan: "breakfast", food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: true, includeFlight: true,
});

function Harness({ adjustments = emptyAdjustments() }: { adjustments?: QuoteAdjustments }) {
  const [request, setRequest] = useState(initial);
  const quote = useMemo(() => generateQuotation(request, { core, routes, visaRules, bundles }), [request]);
  return (
    <>
      <MarginPanel quote={quote} adjustments={adjustments} />
      <PriceSplitPanel quote={quote} adjustments={adjustments} onChange={setRequest} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const money = (el: HTMLElement) => Number(el.textContent!.replace(/[^\d]/g, ""));

describe("admin cost and agency cut", () => {
  it("shows actual cost, the agency's cut and what the traveller pays, which add up", () => {
    render(<Harness />);
    const panel = screen.getByLabelText("Cost and agency cut");
    const quote = generateQuotation(initial, { core, routes, visaRules, bundles });
    const m = summariseMargin(quote, emptyAdjustments());

    const total = within(panel).getByRole("row", { name: /^Total/ });
    const cells = within(total).getAllByRole("cell");
    expect(money(cells[0])).toBe(m.costInr);
    expect(money(cells[2])).toBe(m.totalInr);
    expect(m.costInr + m.cutInr + m.taxInr).toBe(m.totalInr);
    expect(within(panel).getByText("Actual cost")).toBeTruthy();
    expect(within(panel).getAllByText("Agency cut").length).toBe(2); // headline card and table column
    expect(within(panel).getByText(/not yours to keep/)).toBeTruthy();
  });

  it("follows an edited rate: more cost, more cut", () => {
    render(<Harness />);
    const panel = screen.getByLabelText("Cost and agency cut");
    const cost = () => money(within(within(panel).getByRole("row", { name: /^Total/ })).getAllByRole("cell")[0]);
    const before = cost();
    const rate = screen.getAllByLabelText(/rate/i)[0] as HTMLInputElement;
    fireEvent.change(rate, { target: { value: String(Math.round(Number(rate.value.replace(/[^\d.]/g, "")) * 2)) } });
    fireEvent.blur(rate);
    expect(cost()).toBeGreaterThan(before);
  });

  it("says plainly when a pinned price loses money", () => {
    const quote = generateQuotation(initial, { core, routes, visaRules, bundles });
    render(<Harness adjustments={{ ...emptyAdjustments(), fixedPackageInr: Math.round(quote.totals.directCost * 0.8) }} />);
    expect(screen.getByText(/This quote loses money/)).toBeTruthy();
  });

  it("labels each category header with cost, cut and what the traveller sees", () => {
    render(<Harness />);
    expect(screen.getAllByText(/cost ₹.*cut \+₹.*traveller sees/).length).toBeGreaterThan(0);
  });
});

describe("live airfare lookup", () => {
  it("asks for the arrival and departure country's fare on the airport of the stay, keyed by country", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ rates: [{ component: "flight", key: `DEL:${new URL(String(u), "https://x").searchParams.get("fareKey")}:FSC`, inr: 50_000, fetchedAt: new Date().toISOString() }] }));
    }));
    const quote = generateQuotation({ ...initial, placeIds: ["paris", "rome"], nights: 6 }, { core, routes, visaRules, bundles: new Map() });
    const map = await loadFlightLiveRates(core, quote);
    const params = urls.map((u) => new URL(u, "https://x").searchParams);
    // Two round trips (one per country) plus the open-jaw ticket, because the trip ends in a different country.
    expect(params.length).toBe(3);
    expect(params.every((p) => p.get("origin") === "DEL" && p.get("carrier") === "FSC" && p.get("month") === "2026-11")).toBe(true);
    const countryOf = (id: string) => core.places.find((p) => p.id === id)!.countryId;
    const first = quote.stays[0].placeId;
    const last = quote.stays[quote.stays.length - 1].placeId;
    const roundTrips = params.filter((p) => !p.get("returnFrom"));
    const jaw = params.filter((p) => p.get("returnFrom"));
    expect(roundTrips.map((p) => p.get("fareKey")).sort()).toEqual([countryOf(first), countryOf(last)].sort());
    expect(roundTrips.map((p) => p.get("destinationIata")).sort()).toEqual([core.placeAirports[first].iata, core.placeAirports[last].iata].sort());
    expect(jaw).toHaveLength(1);
    expect(jaw[0].get("fareKey")).toBe(`jaw-${countryOf(first)}-${countryOf(last)}`);
    expect(jaw[0].get("destinationIata")).toBe(core.placeAirports[first].iata);
    expect(jaw[0].get("returnFrom")).toBe(core.placeAirports[last].iata);
    expect([...map.keys()].every((k) => k.startsWith("flight:DEL:") && k.endsWith(":FSC"))).toBe(true);
  });

  it("does not ask when the quote has no flights", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const quote = generateQuotation({ ...initial, includeFlight: false }, { core, routes, visaRules, bundles });
    expect((await loadFlightLiveRates(core, quote)).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
