/**
 * The rules behind the route board, as plain functions so they are tested without a browser. The component only
 * decides which of these to call.
 *
 * A route in a request is `placeOrder`: the stops in the order they are visited. When the last entry repeats an
 * earlier stop, the trip goes back there for its last night and flies home from it. An empty `placeOrder` means
 * "the planner's suggestion".
 */
import type { Quotation, QuoteRequest, RoutePlanCandidate, RoutePlanInfo } from "@retro/core/atlas/engine/types";
import { moveInOrder } from "@retro/core/atlas/engine/routeplan";

/** The request for a route the traveller chose: this order, and optionally an earlier stop to fly home from. */
export function withRoute(request: QuoteRequest, order: string[], returnVia: string | null = null): QuoteRequest {
  const back = returnVia && order.includes(returnVia) && order[order.length - 1] !== returnVia ? [returnVia] : [];
  return { ...request, placeOrder: [...order, ...back] };
}

/** Back to the planner's suggestion. */
export function resetRoute(request: QuoteRequest): QuoteRequest {
  return { ...request, placeOrder: [], routeMode: "auto" };
}

/** True once the route has been set by hand. */
export const isCustomRoute = (request: Pick<QuoteRequest, "placeOrder">) => request.placeOrder.length > 0;

/** Where the dragged stop would land if released at `x`, for slots starting at `firstX` and `gap` apart. */
export function dragTargetIndex(x: number, firstX: number, gap: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round((x - firstX) / gap)));
}

/** The order shown while a stop is being dragged: the others shuffle aside to make room. */
export function previewOrder(order: string[], dragId: string | null, target: number): string[] {
  const from = dragId ? order.indexOf(dragId) : -1;
  return from < 0 ? order : moveInOrder(order, from, target);
}

/** What the current route costs against what was suggested, in words for the headline. */
export function compareToSuggestion(currentInr: number, suggestedInr: number | undefined): { kind: "same" | "more" | "less"; inr: number } | null {
  if (suggestedInr == null) return null;
  const diff = Math.round(currentInr - suggestedInr);
  // A quotation is rounded to whole rupees upstream; below this it is the same price.
  if (Math.abs(diff) < 50) return { kind: "same", inr: 0 };
  return diff > 0 ? { kind: "more", inr: diff } : { kind: "less", inr: -diff };
}

/** Labels for the plans the planner rates best on each objective. */
export function badgesFor(plan: Pick<RoutePlanInfo, "best" | "suggestion">, candidate: Pick<RoutePlanCandidate, "id">): ("Cheapest" | "Fastest" | "Balanced" | "Suggested")[] {
  const out: ("Cheapest" | "Fastest" | "Balanced" | "Suggested")[] = [];
  if (plan.suggestion?.id === candidate.id) out.push("Suggested");
  if (plan.best.cheapest === candidate.id) out.push("Cheapest");
  if (plan.best.balanced === candidate.id) out.push("Balanced");
  if (plan.best.fastest === candidate.id) out.push("Fastest");
  return out;
}

/** Where a stop may be returned to for the flight home: any stop but the last, with a night to give. */
export function returnChoices(plan: Pick<RoutePlanInfo, "stops">, order: string[]): string[] {
  const last = order[order.length - 1];
  return order.filter((id) => id !== last && (plan.stops.find((s) => s.id === id)?.nights ?? 0) >= 2);
}

/** Layout of the board, in SVG units. */
export const BOARD = { gap: 132, edge: 44, height: 168, y: 84 } as const;
export const slotX = (i: number) => BOARD.edge + (i + 1) * BOARD.gap;
export const boardWidth = (nodes: number) => BOARD.edge * 2 + (nodes + 1) * BOARD.gap;

/**
 * Keeps the route the quotation is showing. A transport mode pinned to one hop belongs to that hop, and the planner
 * re-runs on every change to the request, so without this the pin could move the route from under itself. Nothing
 * changes when the route is already set by hand or there is no plan to keep.
 */
export function freezeRoute(request: QuoteRequest, quote: Pick<Quotation, "routePlan">): QuoteRequest {
  const plan = quote.routePlan;
  if (request.placeOrder.length || !plan) return request;
  const current = plan.candidates.find((c) => c.id === plan.currentId);
  return current ? withRoute(request, current.order, current.returnVia) : request;
}
