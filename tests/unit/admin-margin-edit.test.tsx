import { afterEach, describe, expect, it } from "vitest";
import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { emptyAdjustments, summariseMargin } from "@retro/core/quote-pricing";
import { MarginPanel } from "@/components/admin/MarginPanel";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;
const bundles = new Map<string, DestinationBundle>();
for (const id of ["paris", "rome"]) {
  const place = core.places.find((p) => p.id === id)!;
  try { bundles.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8"))); } catch { /* none */ }
}

const initial = QuoteRequest.parse({
  placeIds: ["paris", "rome"], nights: 6, startDate: "2026-12-20", adults: 2, childAges: [], travellerType: "couple", tripStyle: "romantic",
  nationality: "IND", departureCity: "DEL", hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy",
  mealPlan: "breakfast", food: "no-preference", pace: "balanced", includeVisa: false, includeInsurance: false, includeFlight: false,
});

function Harness({ onTotal }: { onTotal: (n: number) => void }) {
  const [request, setRequest] = useState(initial);
  const quote = useMemo(() => generateQuotation(request, { core, routes, visaRules, bundles }), [request]);
  onTotal(summariseMargin(quote, emptyAdjustments()).totalInr);
  return <MarginPanel quote={quote} adjustments={emptyAdjustments()} request={request} onChange={setRequest} />;
}

afterEach(cleanup);

const type = (el: HTMLElement, v: string) => {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: v } });
  fireEvent.blur(el);
};

describe("editing the margin in the admin panel", () => {
  it("warns that setting a margin drops the published-price floor when the quote was floored", () => {
    const pkg = core.packages.find((p) => p.id === "africa-kenya-safari")!;
    const req = QuoteRequest.parse({ ...initial, placeIds: pkg.placeIds, nights: pkg.nights, adults: 3, childAges: [6, 2], hotelStar: "3 Star", includeFlight: true });
    const q = generateQuotation(req, { core, routes, visaRules, bundles: new Map() });
    expect(q.totals.flooredToPackage).toBeTruthy();
    render(<MarginPanel quote={q} adjustments={emptyAdjustments()} request={req} onChange={() => {}} />);
    expect(screen.getByText(/setting a margin turns that floor off/i)).toBeTruthy();
  });

  it("typing an overall margin re-prices the quote, and Back to automatic restores it", () => {
    let total = 0;
    render(<Harness onTotal={(n) => (total = n)} />);
    const auto = total;
    expect(screen.queryByRole("button", { name: /back to automatic/i })).toBeNull();

    type(screen.getByLabelText(/margin on cost, percent, applied to every category/i), "30");
    const higher = total;
    expect(higher).toBeGreaterThan(auto);
    expect(screen.getByText(/set by you/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /back to automatic/i }));
    expect(total).toBe(auto);
  });

  it("a category's own margin changes just that row's cut", () => {
    let total = 0;
    render(<Harness onTotal={(n) => (total = n)} />);
    const auto = total;
    type(screen.getByLabelText(/margin on cost for accommodation, percent/i), "50");
    expect(total).toBeGreaterThan(auto);
    expect(screen.getByRole("button", { name: /use the overall margin for accommodation/i })).toBeTruthy();
  });

  it("ignores junk and out-of-range values", () => {
    let total = 0;
    render(<Harness onTotal={(n) => (total = n)} />);
    const auto = total;
    const field = screen.getByLabelText(/margin on cost, percent, applied to every category/i);
    type(field, "abc");
    type(field, "150");
    type(field, "-5");
    expect(total).toBe(auto);
  });
});
