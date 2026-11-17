import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import type { QuoteRequest } from "@retro/core/atlas/engine/types";
import { RouteBoard } from "@/components/plan/RouteBoard";
import {
  BOARD, badgesFor, boardWidth, compareToSuggestion, dragTargetIndex, isCustomRoute, previewOrder, resetRoute,
  freezeRoute, returnChoices, slotX, withRoute,
} from "@/components/plan/route-board";

const ATLAS = path.join("public", "atlas");
const read = (p: string) => JSON.parse(readFileSync(path.join(ATLAS, p), "utf8"));
const core = CoreBundle.parse(read("core.json"));
const routes: Route[] = read("routes.json").routes;
const visaRules: VisaRule[] = read("visa.json").rules;

function build(ids: string[], nights: number, over: Partial<QuoteRequest> = {}) {
  const bundles = new Map<string, DestinationBundle>();
  for (const id of ids) {
    const place = core.places.find((p) => p.id === id)!;
    bundles.set(id, JSON.parse(readFileSync(path.join(ATLAS, "destinations", `${place.slug}.json`), "utf8")));
  }
  const request = {
    placeIds: ids, nights, startDate: "2026-06-10", adults: 2, childAges: [],
    travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "DEL",
    hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast",
    food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: false, includeFlight: true,
    interests: [], firstTimeVisitor: true, transportPreference: "balanced", legModes: {},
    excludedActivityCodes: [], excludedClusterIds: [], excludedLineKeys: [], lineOverrides: {}, marginPct: null,
    componentMarginPct: {}, customLines: [], sightseeingMode: "auto", addedActivityCodes: [], pinnedClusterIds: [],
    placeOrder: [], routeMode: "auto", nightOverrides: {}, clusterDays: {},
    ...over,
  } as QuoteRequest;
  return { request, quote: generateQuotation(request, { core, routes, visaRules, bundles }) };
}

const IDS = ["paris", "amsterdam", "brussels"];

describe("route board rules", () => {
  const base = build(IDS, 7).request;

  it("writes a route into the request, with an optional stop to fly home from", () => {
    expect(withRoute(base, ["a", "b", "c"]).placeOrder).toEqual(["a", "b", "c"]);
    expect(withRoute(base, ["a", "b", "c"], "a").placeOrder).toEqual(["a", "b", "c", "a"]);
  });

  it("ignores a return to the last stop or to a stop not on the route", () => {
    expect(withRoute(base, ["a", "b"], "b").placeOrder).toEqual(["a", "b"]);
    expect(withRoute(base, ["a", "b"], "z").placeOrder).toEqual(["a", "b"]);
  });

  it("resets to the suggestion and knows when a route is custom", () => {
    const custom = withRoute(base, ["a", "b"]);
    expect(isCustomRoute(custom)).toBe(true);
    expect(isCustomRoute(base)).toBe(false);
    expect(resetRoute(custom).placeOrder).toEqual([]);
    expect(resetRoute({ ...custom, routeMode: "classic" }).routeMode).toBe("auto");
  });

  it("finds the slot a dragged stop would drop into, and stays inside the line", () => {
    const g = BOARD.gap;
    expect(dragTargetIndex(slotX(0), slotX(0), g, 3)).toBe(0);
    expect(dragTargetIndex(slotX(0) + g * 0.6, slotX(0), g, 3)).toBe(1);
    expect(dragTargetIndex(slotX(0) + g * 0.4, slotX(0), g, 3)).toBe(0);
    expect(dragTargetIndex(99_999, slotX(0), g, 3)).toBe(2);
    expect(dragTargetIndex(-99_999, slotX(0), g, 3)).toBe(0);
    expect(dragTargetIndex(10, 0, g, 0)).toBe(0);
  });

  it("shuffles the others aside while one is dragged", () => {
    expect(previewOrder(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(previewOrder(["a", "b", "c"], null, 2)).toEqual(["a", "b", "c"]);
    expect(previewOrder(["a", "b", "c"], "z", 1)).toEqual(["a", "b", "c"]);
  });

  it("says how a route compares with the suggestion, ignoring rounding", () => {
    expect(compareToSuggestion(100_000, 100_030)).toEqual({ kind: "same", inr: 0 });
    expect(compareToSuggestion(120_000, 100_000)).toEqual({ kind: "more", inr: 20_000 });
    expect(compareToSuggestion(90_000, 100_000)).toEqual({ kind: "less", inr: 10_000 });
    expect(compareToSuggestion(90_000, undefined)).toBeNull();
  });

  it("offers a return only to stops with a night to give, never to the last stop", () => {
    const plan = { stops: [{ id: "a", name: "A", nights: 3, airport: "X" }, { id: "b", name: "B", nights: 1, airport: "Y" }, { id: "c", name: "C", nights: 2, airport: "Z" }] };
    expect(returnChoices(plan, ["a", "b", "c"])).toEqual(["a"]);
  });

  it("labels the plans the planner rates best", () => {
    const plan = { best: { cheapest: "x", balanced: "y", fastest: "x" }, suggestion: { id: "y", order: [], names: [], returnVia: null, totalInr: 0 } };
    expect(badgesFor(plan, { id: "x" })).toEqual(["Cheapest", "Fastest"]);
    expect(badgesFor(plan, { id: "y" })).toEqual(["Suggested", "Balanced"]);
    expect(badgesFor(plan, { id: "z" })).toEqual([]);
  });

  it("keeps the route on screen when a leg is pinned, and leaves a hand-made route alone", () => {
    const { request, quote } = build(IDS, 7);
    const plan = quote.routePlan!;
    const cur = plan.candidates.find((c) => c.id === plan.currentId)!;
    const frozen = freezeRoute(request, quote);
    expect(frozen.placeOrder).toEqual([...cur.order, ...(cur.returnVia ? [cur.returnVia] : [])]);
    // Pricing the frozen request gives the same route back.
    expect(build(IDS, 7, { placeOrder: frozen.placeOrder }).quote.routePlan!.currentId).toBe(plan.currentId);
    const mine = withRoute(request, ["brussels", "paris", "amsterdam"]);
    expect(freezeRoute(mine, quote)).toBe(mine);
    expect(freezeRoute(request, { routePlan: undefined })).toBe(request);
  });

  it("lays out one slot per stop", () => {
    expect(boardWidth(3)).toBe(BOARD.edge * 2 + 4 * BOARD.gap);
    expect(slotX(1) - slotX(0)).toBe(BOARD.gap);
  });
});

describe("RouteBoard", () => {
  const classic = build(IDS, 7, { routeMode: "classic" });
  const order = classic.quote.routePlan!.candidates.find((c) => c.id === classic.quote.routePlan!.currentId)!.order;

  // The board reads the plan out of the quotation, so a plain classic quote gives it a known route to work on.
  const setup = (over: Partial<QuoteRequest> = {}) => {
    const { quote, request } = build(IDS, 7, over);
    const onChange = vi.fn();
    render(<RouteBoard quote={quote} request={request} onChange={onChange} />);
    return { quote, request, onChange };
  };
  const placeOrderOf = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)![0] as QuoteRequest).placeOrder;

  it("draws every stop of the route with its nights", () => {
    const { quote } = setup();
    const plan = quote.routePlan!;
    const route = plan.candidates.find((c) => c.id === plan.currentId)!.order;
    for (const id of route) expect(screen.getByTestId(`route-stop-${id}`)).toBeInTheDocument();
    expect(screen.getAllByText(/night/).length).toBeGreaterThanOrEqual(route.length);
  });

  it("says which airport the trip lands at and flies home from", () => {
    setup();
    expect(screen.getByTestId("route-board-summary")).toHaveTextContent(/Return ticket, in and out of|Open-jaw ticket/);
  });

  it("shows the way back to an earlier stop when the trip flies home from one", () => {
    const { quote } = setup();
    expect(quote.routePlan!.candidates.find((c) => c.id === quote.routePlan!.currentId)!.returnVia).not.toBeNull();
    expect(screen.getByTestId("route-board-return")).toBeInTheDocument();
  });

  it("renders nothing for a trip with a single stop", () => {
    const { quote, request } = build(["paris"], 4);
    const { container } = render(<RouteBoard quote={quote} request={request} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reverses the route", () => {
    const { onChange } = setup({ routeMode: "classic" });
    fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
    expect(placeOrderOf(onChange)).toEqual([...order].reverse());
  });

  it("shuffles into a different order of the same stops", () => {
    const { onChange } = setup({ routeMode: "classic" });
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    const got = placeOrderOf(onChange);
    expect([...got].sort()).toEqual([...order].sort());
    expect(got).not.toEqual(order);
  });

  it("moves a stop with the arrow keys, and with the buttons", () => {
    const { onChange } = setup({ routeMode: "classic" });
    fireEvent.keyDown(screen.getByTestId(`route-stop-${order[0]}`), { key: "ArrowRight" });
    expect(placeOrderOf(onChange)).toEqual([order[1], order[0], order[2]]);
    fireEvent.click(within(screen.getByRole("group", { name: "Move stops" })).getAllByRole("button", { name: /earlier/ })[2]);
    expect(placeOrderOf(onChange)).toEqual([order[0], order[2], order[1]]);
  });

  it("does not move the first stop earlier or the last later", () => {
    setup({ routeMode: "classic" });
    const group = within(screen.getByRole("group", { name: "Move stops" }));
    expect(group.getAllByRole("button", { name: /earlier/ })[0]).toBeDisabled();
    expect(group.getAllByRole("button", { name: /later/ }).at(-1)).toBeDisabled();
  });

  it("drags a stop to a new place in the line", () => {
    const { onChange } = setup({ routeMode: "classic" });
    const svg = screen.getByTestId("route-board-svg");
    const width = boardWidth(order.length);
    // One SVG unit is one pixel, so pointer x is board x.
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 168, right: width, bottom: 168, x: 0, y: 0, toJSON: () => ({}) });
    const first = screen.getByTestId(`route-stop-${order[0]}`);
    fireEvent.pointerDown(first, { clientX: slotX(0), clientY: 84, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: slotX(2), clientY: 84, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: slotX(2), clientY: 84, pointerId: 1 });
    expect(placeOrderOf(onChange)).toEqual([order[1], order[2], order[0]]);
  });

  it("treats a click without movement as no change", () => {
    const { onChange } = setup({ routeMode: "classic" });
    const svg = screen.getByTestId("route-board-svg");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 168, right: 600, bottom: 168, x: 0, y: 0, toJSON: () => ({}) });
    const first = screen.getByTestId(`route-stop-${order[0]}`);
    fireEvent.pointerDown(first, { clientX: slotX(0), clientY: 84, button: 0, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: slotX(0), clientY: 84, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has nothing to reset while the suggestion is showing", () => {
    setup();
    expect(screen.getByTestId("route-reset")).toBeDisabled();
  });

  it("resets a hand-made route to the suggestion", () => {
    const { onChange } = setup({ placeOrder: ["brussels", "paris", "amsterdam"] });
    const reset = screen.getByTestId("route-reset");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect((onChange.mock.calls[0][0] as QuoteRequest).placeOrder).toEqual([]);
  });

  it("compares a hand-made route with the suggestion's price", () => {
    setup({ placeOrder: ["brussels", "paris", "amsterdam"] });
    expect(screen.getByTestId("route-board-compare")).toHaveTextContent(/more than our suggestion|less than our suggestion|Same price/);
  });

  it("re-plans for the objective picked", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Fastest" }));
    expect((onChange.mock.calls[0][0] as QuoteRequest).transportPreference).toBe("fastest");
  });

  it("picks the stop to fly home from", () => {
    const { onChange } = setup({ routeMode: "classic", placeOrder: ["amsterdam", "brussels", "paris"] });
    const select = screen.getByTestId("route-fly-home");
    fireEvent.change(select, { target: { value: "amsterdam" } });
    expect(placeOrderOf(onChange)).toEqual(["amsterdam", "brussels", "paris", "amsterdam"]);
  });

  it("lists the other routes it compared and applies the one chosen", () => {
    const { onChange } = setup();
    const list = screen.getByTestId("route-alternatives");
    const buttons = within(list).getAllByRole("button", { name: "Use this route" });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
