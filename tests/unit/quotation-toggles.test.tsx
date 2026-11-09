import { describe, expect, it } from "vitest";
import { useMemo, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { QuotationView } from "@/components/plan/QuotationView";
import { AuthProvider } from "@/components/auth/AuthProvider";

/**
 * The traveller customises a trip by ticking and unticking things. Nothing they
 * switch off may disappear from the page: it has to stay put, visibly off, and
 * come back exactly as it was when they switch it on again.
 */
const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function bundlesFor(placeIds: string[]): Map<string, DestinationBundle> {
  const map = new Map<string, DestinationBundle>();
  for (const id of placeIds) {
    const place = core.places.find((p) => p.id === id);
    if (!place) continue;
    try {
      map.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8")));
    } catch {
      /* no bundle for this place */
    }
  }
  return map;
}

const initial = QuoteRequest.parse({
  placeIds: ["cairo", "luxor"],
  nights: 6,
  startDate: "2026-11-15",
  adults: 2,
  childAges: [],
  travellerType: "couple",
  tripStyle: STYLE_FOR_TRAVELLER.couple,
  nationality: "IND",
  departureCity: "DEL",
  hotelStar: "4 Star",
  hotelZone: "Central",
  carrier: "FSC",
  cabin: "Economy",
  mealPlan: "breakfast",
  food: "no-preference",
  pace: "balanced",
  includeVisa: true,
  includeInsurance: true,
  includeFlight: false,
});

/** The real view, driven the way the planner drives it: every edit re-prices. */
function Harness() {
  const [request, setRequest] = useState(initial);
  const quote = useMemo(
    () => generateQuotation(request, { core, routes, visaRules, bundles: bundlesFor(request.placeIds) }),
    [request],
  );
  return (
    <AuthProvider>
      <QuotationView quote={quote} request={request} onChange={setRequest} onBack={() => {}} destinationSummary="Egypt" />
    </AuthProvider>
  );
}

const outings = () => screen.getAllByRole("checkbox", { name: /^Include / }) as HTMLInputElement[];
const snapshot = () => outings().map((c) => [c.getAttribute("aria-label"), c.checked] as const);

describe("customising the day-by-day plan", () => {
  it("keeps an unticked outing on the page, struck through, and restores it when ticked again", () => {
    render(<Harness />);
    const before = snapshot();
    expect(before.length).toBeGreaterThan(2);
    expect(before.every(([, on]) => on)).toBe(true);

    fireEvent.click(outings()[0]);
    const off = snapshot();
    expect(off.map(([label]) => label)).toEqual(before.map(([label]) => label));
    expect(off[0][1]).toBe(false);
    expect(off.slice(1).every(([, on]) => on)).toBe(true);
    // Visibly off, not merely unchecked.
    const row = outings()[0].closest("li")!;
    expect(row.querySelector(".line-through")).not.toBeNull();

    fireEvent.click(outings()[0]);
    expect(snapshot()).toEqual(before);
  });

  it("lets every outing be unticked and ticked again in any order without losing a row", () => {
    render(<Harness />);
    const before = snapshot();
    const n = before.length;

    for (let i = 0; i < n; i++) {
      fireEvent.click(outings()[i]);
      expect(outings()).toHaveLength(n);
    }
    expect(snapshot().every(([, on]) => !on)).toBe(true);

    for (let i = n - 1; i >= 0; i--) {
      fireEvent.click(outings()[i]);
      expect(outings()).toHaveLength(n);
    }
    expect(snapshot()).toEqual(before);
  });
});

describe("customising the nights", () => {
  const slider = (name: RegExp) => screen.getByRole("slider", { name }) as HTMLInputElement;

  it("keeps a destination's slider when it is slid down to no nights, so it can be added back", () => {
    render(<Harness />);
    const luxor = slider(/nights in luxor/i);
    const original = Number(luxor.value);
    expect(original).toBeGreaterThan(0);

    fireEvent.change(luxor, { target: { value: "0" } });
    const dropped = slider(/nights in luxor/i);
    expect(dropped.value).toBe("0");
    expect(screen.getByText(/not in this trip/i)).toBeInTheDocument();
    // The other destination is still there and still adjustable.
    expect(slider(/nights in cairo/i)).toBeInTheDocument();

    fireEvent.change(dropped, { target: { value: String(original) } });
    expect(slider(/nights in luxor/i).value).toBe(String(original));
    expect(screen.queryByText(/not in this trip/i)).toBeNull();
  });
});
