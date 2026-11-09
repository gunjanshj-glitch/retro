import { describe, expect, it } from "vitest";
import { useMemo, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { QuotationView } from "@/components/plan/QuotationView";
import { AuthProvider } from "@/components/auth/AuthProvider";

/**
 * Kolkata to Bangkok and Pattaya. The page has to say where the flight lands,
 * return the trip to Bangkok for the flight home, and still let the traveller
 * slide nights per destination even though Bangkok appears twice in the route.
 */
const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function bundlesFor(placeIds: string[]): Map<string, DestinationBundle> {
  const map = new Map<string, DestinationBundle>();
  for (const id of placeIds) {
    const place = core.places.find((p) => p.id === id);
    try {
      map.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place!.slug}.json`), "utf8")));
    } catch {
      /* no bundle for this place */
    }
  }
  return map;
}

const initial = QuoteRequest.parse({
  placeIds: ["bangkok", "pattaya"], nights: 7, startDate: "2026-12-21", adults: 2, childAges: [],
  travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "CCU",
  hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast",
  food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: true, includeFlight: true,
});

function Harness() {
  const [request, setRequest] = useState(initial);
  const quote = useMemo(
    () => generateQuotation(request, { core, routes, visaRules, bundles: bundlesFor(request.placeIds) }),
    [request],
  );
  return (
    <AuthProvider>
      <QuotationView quote={quote} request={request} onChange={setRequest} onBack={() => {}} destinationSummary="Thailand" />
    </AuthProvider>
  );
}

const slider = (name: string) => screen.getByRole("slider", { name: `Nights in ${name}` }) as HTMLInputElement;

describe("the quotation page for a trip that returns to the airport city", () => {
  it("shows where the flight goes from and to, in both directions", () => {
    render(<Harness />);
    const card = screen.getByTestId("flights-card");
    expect(within(card).getByText(/Kolkata \(CCU\) → Suvarnabhumi Airport \(BKK\)/)).toBeTruthy();
    expect(within(card).getByText(/Suvarnabhumi Airport \(BKK\) → Kolkata \(CCU\)/)).toBeTruthy();
    expect(within(card).getByText(/2026-12-21/)).toBeTruthy();
    expect(within(card).getByText(/2026-12-28/)).toBeTruthy();
    expect(within(card).getByText(/BKK and DMK both serve Bangkok/)).toBeTruthy();
  });

  it("marks the day the couple lands and the day they fly home", () => {
    render(<Harness />);
    expect(screen.getByTestId("airport-arrival").textContent).toMatch(/Land · BKK/);
    expect(screen.getByTestId("airport-departure").textContent).toMatch(/Fly home · BKK/);
    expect(screen.getByText(/Land at Suvarnabhumi Airport \(BKK\), transfer to Bangkok and check in/)).toBeTruthy();
    expect(screen.getByText(/transfer to Suvarnabhumi Airport \(BKK\) for the flight home/)).toBeTruthy();
  });

  it("lists the route as Bangkok, Pattaya, Bangkok", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Bangkok · Pattaya · Bangkok");
  });

  it("has one night slider per destination, carrying all of its nights", () => {
    render(<Harness />);
    expect(screen.getAllByRole("slider").filter((s) => /^Nights in /.test(s.getAttribute("aria-label") ?? ""))).toHaveLength(2);
    expect(slider("Bangkok").value).toBe("4");
    expect(slider("Pattaya").value).toBe("3");
  });

  it("moves both Bangkok visits when the Bangkok slider moves, and keeps the airport at both ends", () => {
    render(<Harness />);
    fireEvent.change(slider("Bangkok"), { target: { value: "6" } });
    expect(slider("Bangkok").value).toBe("6");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Bangkok · Pattaya · Bangkok");
    expect(screen.getByTestId("airport-arrival")).toBeTruthy();
    expect(screen.getByTestId("airport-departure")).toBeTruthy();
  });

  it("drops back to Bangkok then Pattaya only when Bangkok has a single night to give, and brings it back", () => {
    render(<Harness />);
    fireEvent.change(slider("Bangkok"), { target: { value: "1" } });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Pattaya · Bangkok");
    fireEvent.change(slider("Bangkok"), { target: { value: "4" } });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Bangkok · Pattaya · Bangkok");
  });

  it("keeps a destination's slider when its nights go to zero, so it can be brought back", () => {
    render(<Harness />);
    fireEvent.change(slider("Pattaya"), { target: { value: "0" } });
    expect(slider("Pattaya").value).toBe("0");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Bangkok");
    fireEvent.change(slider("Pattaya"), { target: { value: "3" } });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Bangkok · Pattaya · Bangkok");
  });

  it("offers a separate transport choice for the way out and the way back", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Transport from Bangkok to Pattaya" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Transport from Pattaya to Bangkok" })).toBeTruthy();
  });
});
