/**
 * Regression: the nights slider used to snap back to the recommendation whenever the traveller touched Hotel
 * category or Pace (two controls with nothing to do with trip length). Seen live as "I set 10 nights, I click
 * anything, it becomes 20".
 */
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle } from "@retro/core/atlas/schema";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { computeNightsBounds } from "@retro/core/atlas/engine/bounds";
import { DecisionMatrix } from "@/components/plan/DecisionMatrix";

const core = CoreBundle.parse(JSON.parse(readFileSync(path.join("public", "atlas", "core.json"), "utf8")));
const PLACES = ["ha-noi", "danang", "hochiminh", "phu-quoc"];

const start = (): QuoteRequest =>
  QuoteRequest.parse({
    placeIds: PLACES, nights: 10, startDate: "2027-04-17", adults: 3, childAges: [], travellerType: "family",
    tripStyle: "family", nationality: "IND", departureCity: "CCU", hotelStar: "4 Star", hotelZone: "Central",
    carrier: "LCC", cabin: "Economy", mealPlan: "breakfast", food: "no-preference", pace: "balanced",
    includeVisa: true, includeInsurance: false, includeFlight: true,
  });

let latest: QuoteRequest = start();
function Harness() {
  const [request, setRequest] = useState<QuoteRequest>(start());
  useEffect(() => {
    latest = request;
  }, [request]);
  return <DecisionMatrix core={core} value={request} onChange={(fn) => setRequest(fn)} />;
}

const pick = (group: string, name: string) =>
  fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name }));
const setNights = (n: number) => {
  fireEvent.change(screen.getByLabelText("Number of nights"), { target: { value: String(n) } });
};

describe("DecisionMatrix nights", () => {
  it("keeps the nights the traveller chose when they change hotel, pace, cabin or meals", async () => {
    render(<Harness />);
    await act(async () => {});
    setNights(10);
    expect(latest.nights).toBe(10);

    pick("Hotel category", "5 Star");
    expect(latest.hotelStar).toBe("5 Star");
    pick("Pace", "Relaxed");
    expect(latest.pace).toBe("relaxed");
    pick("Hotel category", "3 Star");
    pick("Cabin", "Premium economy");
    pick("Pace", "Packed");

    expect(latest.nights).toBe(10);
  });

  it("still suggests a new length when who is travelling changes", async () => {
    render(<Harness />);
    await act(async () => {});
    setNights(10);
    pick("Traveller type", "Stags");
    const stag = computeNightsBounds(core, PLACES, { travellerType: "stags", tripStyle: latest.tripStyle });
    expect(latest.nights).toBe(Math.min(Math.max(stag.recommended, stag.min), stag.max));
  });
});
