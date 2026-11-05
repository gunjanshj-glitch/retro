"use client";

/**
 * Admin-only price split. Shows every charge behind each category the traveller
 * sees (airport transfers, sightseeing transport, entrances, and so on) and
 * lets the agency switch individual lines off or back on. A switched-off line is
 * dropped from the total, with contingency, margin and tax recomputed. The
 * traveller's quote page only ever shows the category rows, never this.
 */
import { formatInr } from "@retro/core/atlas/engine/text";
import type { LineItem, QuoteRequest, Quotation } from "@retro/core/atlas/engine/types";
import { COMPONENT_LABEL, componentBreakdown } from "@retro/core/quote-pricing";
import { btnSmall } from "@/components/plan/theme";

type Props = {
  quote: Quotation;
  onChange: (next: (r: QuoteRequest) => QuoteRequest) => void;
  disabled?: boolean;
};

export function PriceSplitPanel({ quote, onChange, disabled }: Props) {
  const active = quote.lineItems;
  const off = quote.excludedLineItems ?? [];
  const shown = new Map(componentBreakdown(quote, quote.totals.total).map((r) => [r.key, r.amountInr]));

  const groups = new Map<string, { on: LineItem[]; off: LineItem[] }>();
  const slot = (c: string) => {
    let g = groups.get(c);
    if (!g) groups.set(c, (g = { on: [], off: [] }));
    return g;
  };
  for (const i of active) slot(i.component).on.push(i);
  for (const i of off) slot(i.component).off.push(i);
  const rows = [...groups.entries()].sort(
    (a, b) => b[1].on.reduce((s, i) => s + i.totalInr, 0) - a[1].on.reduce((s, i) => s + i.totalInr, 0),
  );

  const setKeys = (keys: string[], switchOff: boolean) =>
    onChange((r) => {
      const next = new Set(r.excludedLineKeys);
      for (const k of keys) {
        if (switchOff) next.add(k);
        else next.delete(k);
      }
      return { ...r, excludedLineKeys: [...next] };
    });

  const removed = off.reduce((s, i) => s + i.totalInr, 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Tick what the traveller pays for. Untick a line to drop it from the price. Travellers see only the category totals, not these lines.
        {off.length > 0 && (
          <>
            {" "}
            <span className="font-semibold" style={{ color: "var(--warning)" }}>
              {off.length} line{off.length === 1 ? "" : "s"} switched off ({formatInr(removed)} of base cost).
            </span>
          </>
        )}
      </p>

      {rows.map(([component, g]) => {
        const base = g.on.reduce((s, i) => s + i.totalInr, 0);
        const all = [...g.on, ...g.off];
        return (
          <details key={component} className="group rounded-xl border bg-[var(--card)]" style={{ borderColor: "var(--line)" }}>
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl p-4 transition-colors hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 font-semibold">
                <svg className="shrink-0 -rotate-90 transition-transform group-open:rotate-0" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: "var(--ink-2)" }}>
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {COMPONENT_LABEL[component] ?? component}
                <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>
                  {g.on.length} of {all.length} included
                </span>
              </span>
              <span className="text-sm tabular-nums">
                <span style={{ color: "var(--muted)" }}>base {formatInr(base)} · traveller sees </span>
                <span className="font-bold" style={{ color: "var(--ink)" }}>{formatInr(shown.get(component) ?? 0)}</span>
              </span>
            </summary>
            <div className="border-t p-4" style={{ borderColor: "var(--line)" }}>
              <div className="mb-2 flex flex-wrap gap-2">
                <button type="button" disabled={disabled || !g.off.length} onClick={() => setKeys(g.off.map((i) => i.key), false)} className={btnSmall}>
                  Include all
                </button>
                <button type="button" disabled={disabled || !g.on.length} onClick={() => setKeys(g.on.map((i) => i.key), true)} className={btnSmall}>
                  Remove all
                </button>
              </div>
              <ul className="flex flex-col divide-y divide-[var(--line)]">
                {all.map((item) => {
                  const included = !off.includes(item);
                  return (
                    <li key={item.key} className="py-2">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                          checked={included}
                          disabled={disabled}
                          onChange={() => setKeys([item.key], included)}
                        />
                        <span className="min-w-0 flex-1" style={included ? undefined : { color: "var(--ink-2)", textDecoration: "line-through" }}>
                          <span className="block text-sm">{item.label}</span>
                          <span className="block text-xs" style={{ color: "var(--muted)" }}>
                            {item.detail} · {item.quantity} × {formatInr(item.unitPriceInr)}
                            {item.source === "estimated" ? " · estimated" : ""}
                          </span>
                        </span>
                        <span className="text-sm tabular-nums" style={included ? { fontWeight: 600 } : { color: "var(--ink-2)", textDecoration: "line-through" }}>
                          {formatInr(item.totalInr)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}
