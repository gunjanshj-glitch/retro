import { describe, expect, it } from "vitest";
import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { PriceSplitPanel } from "@/components/admin/PriceSplitPanel";
import { SightseeingPanel } from "@/components/admin/SightseeingPanel";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function bundlesFor(placeIds: string[]) {
  const map = new Map<string, DestinationBundle>();
  for (const id of placeIds) {
    const place = core.places.find((p) => p.id === id)!;
    map.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8")));
  }
  return map;
}

const initial = QuoteRequest.parse({
  placeIds: ["ha-noi"],
  nights: 4,
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
  includeFlight: true,
});

/** The editor's own wiring in miniature: one request, re-priced by the real engine on every edit. */
function Harness() {
  const [request, setRequest] = useState(initial);
  const quote = useMemo(() => generateQuotation(request, { core, routes, visaRules, bundles: bundlesFor(request.placeIds) }), [request]);
  return (
    <>
      <output data-testid="total">{quote.totals.total}</output>
      <output data-testid="direct">{quote.totals.directCost}</output>
      <SightseeingPanel quote={quote} request={request} onChange={setRequest} />
      <PriceSplitPanel quote={quote} onChange={setRequest} />
    </>
  );
}

const total = () => Number(screen.getByTestId("total").textContent);
const direct = () => Number(screen.getByTestId("direct").textContent);

describe("admin price split: editing the actual amount", () => {
  const hotel = generateQuotation(initial, { core, routes, visaRules, bundles: bundlesFor(initial.placeIds) }).lineItems.find((l) => l.component === "hotel")!;

  it("lets the rate be typed over, re-prices the quote, and resets to the engine's figure", () => {
    render(<Harness />);
    const before = total();
    const rate = screen.getByLabelText(`Rate in rupees for ${hotel.label}`) as HTMLInputElement;
    expect(rate.value).toBe(String(hotel.unitPriceInr));

    fireEvent.change(rate, { target: { value: "99,999" } });
    fireEvent.blur(rate);

    expect((screen.getByLabelText(`Rate in rupees for ${hotel.label}`) as HTMLInputElement).value).toBe("99999");
    expect(total()).toBeGreaterThan(before);
    expect(screen.getByText("edited")).toBeTruthy();
    expect(screen.getByText(new RegExp(`engine said ${hotel.quantity} × ₹`))).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Reset" })[0]);
    expect(total()).toBe(before);
    expect(screen.queryByText("edited")).toBeNull();
    cleanup();
  });

  it("lets the quantity be typed over too", () => {
    render(<Harness />);
    const before = direct();
    const qty = screen.getByLabelText(`Quantity for ${hotel.label}`) as HTMLInputElement;
    fireEvent.change(qty, { target: { value: String(hotel.quantity + 1) } });
    fireEvent.blur(qty);
    // One more unit adds one unit's rate to the cost (to within the rupee the engine rounds away).
    expect(Math.abs(direct() - before - hotel.unitPriceInr)).toBeLessThanOrEqual(1);
    cleanup();
  });

  it("snaps back, and changes nothing, when what was typed is not a usable number", () => {
    render(<Harness />);
    const before = total();
    const rate = screen.getByLabelText(`Rate in rupees for ${hotel.label}`) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: "lots" } });
    fireEvent.blur(rate);
    expect(rate.value).toBe(String(hotel.unitPriceInr));
    expect(total()).toBe(before);
    cleanup();
  });

  it("adds a charge to a category and removes it again", () => {
    render(<Harness />);
    const before = direct();
    fireEvent.change(screen.getByLabelText("Add a charge to"), { target: { value: "local-transport" } });
    expect(direct()).toBeGreaterThan(before);
    const desc = screen.getByLabelText("Description of the added charge") as HTMLInputElement;
    expect(desc.value).toBe("Additional charge");

    fireEvent.change(desc, { target: { value: "Cyclo tour" } });
    fireEvent.blur(desc);
    expect((screen.getByLabelText("Description of the added charge") as HTMLInputElement).value).toBe("Cyclo tour");

    fireEvent.click(screen.getByRole("button", { name: "Remove charge" }));
    expect(direct()).toBe(before);
    expect(screen.queryByLabelText("Description of the added charge")).toBeNull();
    cleanup();
  });

  it("an unticked line stays on the page with its tick box so it can come back", () => {
    render(<Harness />);
    const box = screen.getByLabelText(`Charge for ${hotel.label}`) as HTMLInputElement;
    const before = direct();
    fireEvent.click(box);
    expect(direct()).toBeLessThan(before);
    const again = screen.getByLabelText(`Charge for ${hotel.label}`) as HTMLInputElement;
    expect(again.checked).toBe(false);
    fireEvent.click(again);
    expect(direct()).toBe(before);
    cleanup();
  });
});

describe("admin sightseeing picker", () => {
  const tickBoxes = () => within(screen.getByText("How sightseeing is chosen").closest("fieldset")!.parentElement!).getAllByRole("checkbox") as HTMLInputElement[];

  it("keeps every place on the page when one is unticked, and settles on exactly what is ticked in manual mode", () => {
    render(<Harness />);
    const listed = tickBoxes().length;
    expect(listed).toBeGreaterThan(2);

    fireEvent.click(screen.getByLabelText(/I choose the places/));
    // Switching modes changes nothing about what is planned yet.
    const tickedAtSwitch = tickBoxes().filter((b) => b.checked).length;
    expect(tickedAtSwitch).toBeGreaterThan(0);

    // Untick one: no other place is pulled in, and none disappears from the list.
    const first = tickBoxes().find((b) => b.checked)!;
    fireEvent.click(first);
    expect(tickBoxes()).toHaveLength(listed);
    expect(tickBoxes().filter((b) => b.checked)).toHaveLength(tickedAtSwitch - 1);

    // Untick everything in the destination, then bring one back.
    fireEvent.click(screen.getAllByRole("button", { name: "Untick all" })[0]);
    expect(tickBoxes().filter((b) => b.checked)).toHaveLength(0);
    fireEvent.click(tickBoxes()[0]);
    expect(tickBoxes().filter((b) => b.checked)).toHaveLength(1);
    cleanup();
  });
});
