"use client";

/**
 * "Your route": the order the trip travels in, drawn as a small map you can rearrange.
 *
 * The planner has already scored every order and every pair of airports and suggested the one that best suits the
 * traveller's objective (cheapest, balanced, fastest). Here that suggestion is shown as a journey — land, stop to
 * stop, fly home — and can be changed: drag a stop to a new place in the line (or use the arrows), shuffle, reverse,
 * pick another of the ranked plans, or choose which stop to fly home from. Every change is a request edit, so the
 * quotation re-prices as it happens, and Reset returns to the suggestion.
 *
 * Drawn the way the destination map draws a route: a dashed sunshine line, triangle arrowheads, sunshine pins.
 */
import { useId, useRef, useState } from "react";
import type { Quotation, QuoteRequest } from "@retro/core/atlas/engine/types";
import { formatDuration, formatInr } from "@retro/core/atlas/engine/text";
import { moveInOrder, reverseOrder, shuffledOrder } from "@retro/core/atlas/engine/routeplan";
import { btnSmall, cardClass, chipClass, chipStyle, selectStyle, toneStyle } from "./theme";
import {
  BOARD, badgesFor, boardWidth, compareToSuggestion, dragTargetIndex, isCustomRoute, previewOrder, resetRoute,
  returnChoices, slotX, withRoute,
} from "./route-board";

type Props = {
  quote: Quotation;
  request: QuoteRequest;
  onChange: (next: QuoteRequest) => void;
};

const OBJECTIVES = [
  ["cheapest", "Cheapest"],
  ["balanced", "Balanced"],
  ["fastest", "Fastest"],
] as const;

const PLANE = "M0,-9 L2.4,-2.5 L10,1.5 L10,4 L2.4,2 L1.6,7 L4,8.6 L4,10.4 L0,9.4 L-4,10.4 L-4,8.6 L-1.6,7 L-2.4,2 L-10,4 L-10,1.5 L-2.4,-2.5 Z";

const clip = (s: string, n = 15) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function RouteBoard({ quote, request, onChange }: Props) {
  const plan = quote.routePlan;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const titleId = useId();
  const [drag, setDrag] = useState<{ id: string; x: number; from: number; moved: boolean } | null>(null);
  const [announce, setAnnounce] = useState("");

  const current = plan?.candidates.find((c) => c.id === plan.currentId) ?? null;
  const order = current?.order ?? [];
  const returnVia = current?.returnVia ?? null;
  const nameOf = (id: string) => plan?.stops.find((s) => s.id === id)?.name ?? id;
  const nightsOf = (id: string) => quote.stays.filter((s) => s.placeId === id).reduce((a, s) => a + s.nights, 0);

  const custom = isCustomRoute(request);
  const compare = plan?.suggestion ? compareToSuggestion(quote.totals.total, plan.suggestion.totalInr) : null;
  const moreRoutes = plan ? plan.candidates.filter((c) => c.id !== plan.currentId && c.order.length === order.length) : [];

  if (!plan || !current || order.length < 2) return null;

  const home = quote.gateways?.home.code ?? request.departureCity;
  const slots = order.length + (returnVia ? 1 : 0);
  const width = boardWidth(slots);
  const target = drag ? dragTargetIndex(drag.x, slotX(0), BOARD.gap, order.length) : 0;
  const shown = previewOrder(order, drag?.id ?? null, target);

  const apply = (next: string[], via: string | null, said: string) => {
    onChange(withRoute(request, next, via));
    setAnnounce(said);
  };
  const move = (id: string, to: number) => {
    const from = order.indexOf(id);
    if (to < 0 || to >= order.length || to === from) return;
    // Moving the last stop changes where the trip ends; a return to an earlier stop would no longer make sense.
    const next = moveInOrder(order, from, to);
    apply(next, returnVia && returnVia !== next[next.length - 1] ? returnVia : null, `${nameOf(id)} is now stop ${to + 1} of ${order.length}.`);
  };

  const toBoardX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width ? ((clientX - rect.left) * width) / rect.width : clientX;
  };
  const onDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id, x: toBoardX(e.clientX), from: order.indexOf(id), moved: false });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const x = toBoardX(e.clientX);
    setDrag({ ...drag, x, moved: drag.moved || Math.abs(x - slotX(drag.from)) > 6 });
  };
  const onUp = () => {
    if (!drag) return;
    const to = dragTargetIndex(drag.x, slotX(0), BOARD.gap, order.length);
    setDrag(null);
    if (drag.moved) move(drag.id, to);
  };

  const shuffle = () => {
    let next = shuffledOrder(order);
    // A shuffle that lands on the same order shows nothing happening.
    for (let i = 0; i < 5 && next.join() === order.join(); i++) next = shuffledOrder(order);
    apply(next, null, "Shuffled the route.");
  };
  const reset = () => {
    onChange(resetRoute(request));
    setAnnounce("Back to the suggested route.");
  };

  const choices = returnChoices(plan, order);
  const sameAirport = !current.openJaw;
  const xs = new Map(shown.map((id, i) => [id, slotX(i)]));
  if (drag) xs.set(drag.id, Math.max(slotX(0) - BOARD.gap / 2, Math.min(slotX(order.length - 1) + BOARD.gap / 2, drag.x)));
  const lastX = slotX(slots - 1);
  const y = BOARD.y;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId} data-testid="route-board">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id={titleId} className="font-display text-2xl md:text-[28px]">Your route</h3>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Plan the route for">
          {OBJECTIVES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...request, transportPreference: key, legModes: {} })}
              aria-pressed={request.transportPreference === key}
              className={`${chipClass} hover:border-[var(--ink-2)]`}
              style={chipStyle(request.transportPreference === key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {custom
          ? "This is your own order. Drag a stop to change it, or reset to our suggestion."
          : `We compared ${plan.candidateCount.toLocaleString("en-IN")} ways to order these stops and where to fly in and out of, and picked the one that suits a ${request.transportPreference} trip. Drag a stop to try another order — the price follows.`}
      </p>

      <div className={`${cardClass} flex flex-col gap-4 p-4 sm:p-5`}>
        <div className="overflow-x-auto" data-testid="route-board-scroll">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${BOARD.height}`}
            style={{ width: "100%", minWidth: Math.round(width * 0.78), height: "auto", touchAction: "pan-y" }}
            role="group"
            aria-label={`Route: ${[home, ...order.map(nameOf), ...(returnVia ? [nameOf(returnVia)] : []), home].join(" to ")}`}
            data-testid="route-board-svg"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
          >
            {/* flights: home to the first stop, and the last stop home */}
            {[
              { x1: BOARD.edge, x2: xs.get(shown[0]) ?? slotX(0), label: "Land", code: current.entryAirport },
              { x1: lastX, x2: width - BOARD.edge, label: "Fly home", code: current.exitAirport },
            ].map((f) => {
              const mx = (f.x1 + f.x2) / 2;
              return (
                <g key={f.label} aria-hidden="true">
                  <path d={`M${f.x1 + 20},${y - 6} Q${mx},${y - 78} ${f.x2 - 20},${y - 6}`} fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" opacity={0.7} />
                  <g transform={`translate(${mx}, ${y - 42})`}>
                    <circle r={13} fill="var(--card)" stroke="var(--ink-2)" strokeWidth={1.2} />
                    <path d={PLANE} fill="var(--ink)" transform="rotate(90) scale(0.8)" />
                  </g>
                  <text x={mx} y={y - 62} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">{f.label} · {f.code}</text>
                </g>
              );
            })}

            {/* the ground route, dashed with an arrow on each hop */}
            {shown.slice(0, -1).map((id, i) => {
              const a = xs.get(id)!;
              const b = xs.get(shown[i + 1])!;
              return <Hop key={`${id}-${shown[i + 1]}`} from={a} to={b} y={y} />;
            })}
            {returnVia && <Hop from={xs.get(shown[shown.length - 1])!} to={lastX} y={y} dashed />}

            {/* home */}
            {[BOARD.edge, width - BOARD.edge].map((x, i) => (
              <g key={i} aria-hidden="true">
                <circle cx={x} cy={y} r={17} fill="var(--ink)" />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff">{home}</text>
                <text x={x} y={y + 36} textAnchor="middle" fontSize={10} fill="var(--muted)">{i === 0 ? "Home" : "Back home"}</text>
              </g>
            ))}

            {/* the way back to an earlier stop before the flight */}
            {returnVia && (
              <g aria-hidden="true" data-testid="route-board-return">
                <circle cx={lastX} cy={y} r={19} fill="var(--card)" stroke="var(--sun-deep)" strokeWidth={2} strokeDasharray="4 3" />
                <text x={lastX} y={y + 5} textAnchor="middle" fontSize={14} fontWeight={800} fill="var(--sun-deep)">↺</text>
                <text x={lastX} y={y + 40} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">{clip(nameOf(returnVia))}</text>
                <text x={lastX} y={y + 54} textAnchor="middle" fontSize={10} fill="var(--muted)">last night</text>
              </g>
            )}

            {/* the stops, draggable */}
            {order.map((id, i) => {
              const x = xs.get(id)!;
              const dragging = drag?.id === id && drag.moved;
              const position = shown.indexOf(id);
              return (
                <g
                  key={id}
                  transform={`translate(${x}, ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Stop ${i + 1} of ${order.length}: ${nameOf(id)}, ${nightsOf(id)} night${nightsOf(id) === 1 ? "" : "s"}. Drag, or press the left and right arrow keys, to move it.`}
                  data-testid={`route-stop-${id}`}
                  style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none", outline: "none" }}
                  onPointerDown={(e) => onDown(e, id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") { e.preventDefault(); move(id, i - 1); }
                    else if (e.key === "ArrowRight") { e.preventDefault(); move(id, i + 1); }
                  }}
                >
                  <title>{nameOf(id)}</title>
                  <circle r={22} fill="var(--sun)" fillOpacity={dragging ? 1 : 0.92} stroke="var(--sun-deep)" strokeWidth={dragging ? 3 : 1.6} style={dragging ? { filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.25))" } : undefined} />
                  <text y={6} textAnchor="middle" fontSize={16} fontWeight={800} fill="var(--on-sun)" pointerEvents="none">{position + 1}</text>
                  <text y={42} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)" pointerEvents="none">{clip(nameOf(id))}</text>
                  <text y={57} textAnchor="middle" fontSize={10} fill="var(--muted)" pointerEvents="none">{nightsOf(id)} night{nightsOf(id) === 1 ? "" : "s"}</text>
                </g>
              );
            })}
          </svg>
        </div>

        {width * 0.78 > 340 && (
          <p className="-mt-2 text-xs sm:hidden" style={{ color: "var(--muted)" }} data-testid="route-board-hint">
            Swipe sideways to see the whole route.
          </p>
        )}

        {/* the same moves without a drag: for keyboards, touch screens and screen readers */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Route order">
          {order.map((id, i) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border px-1 py-0.5 text-xs font-semibold" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <button type="button" className="min-h-8 min-w-8 rounded-full disabled:opacity-35" disabled={i === 0} onClick={() => move(id, i - 1)} aria-label={`Route order: ${nameOf(id)} one step earlier`}>←</button>
              <span className="px-1">{nameOf(id)}</span>
              <button type="button" className="min-h-8 min-w-8 rounded-full disabled:opacity-35" disabled={i === order.length - 1} onClick={() => move(id, i + 1)} aria-label={`Route order: ${nameOf(id)} one step later`}>→</button>
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnSmall} onClick={shuffle}>Shuffle</button>
          <button type="button" className={btnSmall} onClick={() => apply(reverseOrder(order), null, "Reversed the route.")}>Reverse</button>
          <button type="button" className={btnSmall} onClick={reset} disabled={!custom} data-testid="route-reset">Reset to suggestion</button>
          {choices.length > 0 && (
            <label className="ml-auto flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Fly home from
              <select
                className="min-h-9 rounded-full border-[1.5px] px-3 text-xs font-semibold"
                style={selectStyle}
                value={returnVia ?? ""}
                data-testid="route-fly-home"
                onChange={(e) => apply(order, e.target.value || null, e.target.value ? `Flying home from ${nameOf(e.target.value)}.` : `Flying home from ${nameOf(order[order.length - 1])}.`)}
              >
                <option value="">{nameOf(order[order.length - 1])} (last stop)</option>
                {choices.map((id) => (
                  <option key={id} value={id}>Back to {nameOf(id)}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="route-board-summary">
          <span className="rounded-full border px-2.5 py-1 font-semibold" style={sameAirport ? toneStyle.success : toneStyle.warning}>
            {sameAirport ? `Return ticket, in and out of ${current.entryAirport}` : `Open-jaw ticket: in ${current.entryAirport}, home from ${current.exitAirport}`}
          </span>
          <span className="rounded-full border px-2.5 py-1 font-semibold" style={toneStyle.neutral}>
            {formatDuration(current.groundMinutes)} between stops
          </span>
          {compare && (custom || compare.kind !== "same") && (
            <span className="rounded-full border px-2.5 py-1 font-semibold tabular-nums" style={compare.kind === "more" ? toneStyle.danger : compare.kind === "less" ? toneStyle.success : toneStyle.neutral} data-testid="route-board-compare">
              {compare.kind === "same" ? "Same price as our suggestion" : `${formatInr(compare.inr)} ${compare.kind === "more" ? "more" : "less"} than our suggestion`}
            </span>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>

      {moreRoutes.length > 0 && (
        <details className={`${cardClass} p-4 sm:p-5`} data-testid="route-alternatives">
          <summary className="cursor-pointer text-sm font-semibold">Other routes we compared</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {moreRoutes.map((c) => {
              const delta = c.totalInr - current.totalInr;
              const badges = badgesFor(plan, c);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {c.names.join(" → ")}
                      {c.returnVia ? ` → back to ${nameOf(c.returnVia)}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                      {c.openJaw ? `In ${c.entryAirport}, home from ${c.exitAirport}` : `In and out of ${c.entryAirport}`} · {formatDuration(c.groundMinutes)} between stops ·{" "}
                      {delta === 0 ? "same flights and travel cost" : `${formatInr(Math.abs(delta))} per person ${delta > 0 ? "more" : "less"} on flights and travel`}
                    </p>
                    {badges.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1.5">
                        {badges.map((b) => (
                          <span key={b} className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={toneStyle.accent}>{b}</span>
                        ))}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={btnSmall}
                    onClick={() => (c.id === plan.suggestion?.id ? reset() : apply(c.order, c.returnVia, `Using ${c.names.join(", ")}.`))}
                  >
                    Use this route
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

/** One hop of the ground route: a dashed line with an arrowhead at its middle, as on the destination map. */
function Hop({ from, to, y, dashed = false }: { from: number; to: number; y: number; dashed?: boolean }) {
  const dir = to >= from ? 1 : -1;
  const a = from + dir * 26;
  const b = to - dir * 26;
  const mid = (a + b) / 2;
  return (
    <g aria-hidden="true">
      <path d={`M${a},${y} L${b},${y}`} stroke="var(--sun-deep)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="7 5" opacity={dashed ? 0.55 : 0.9} />
      <path d="M-5,-4.5 L5,0 L-5,4.5 Z" fill="var(--sun-deep)" transform={`translate(${mid}, ${y}) scale(${dir}, 1)`} />
    </g>
  );
}
