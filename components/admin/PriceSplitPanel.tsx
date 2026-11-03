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
            <span style={{ color: "var(--text)" }}>
              {off.length} line{off.length === 1 ? "" : "s"} switched off ({formatInr(removed)} of base cost).
            </span>
          </>
        )}
      </p>

      {rows.map(([component, g]) => {
        const base = g.on.reduce((s, i) => s + i.totalInr, 0);
        const all = [...g.on, ...g.off];
        return (
          <details key={component} className="rounded-xl border" style={{ borderColor: "var(--hairline)" }}>
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4">
              <span className="font-medium">
                {COMPONENT_LABEL[component] ?? component}
                <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                  {g.on.length} of {all.length} included
                </span>
              </span>
              <span className="text-sm tabular-nums">
                <span style={{ color: "var(--muted)" }}>base {formatInr(base)} · traveller sees </span>
                <span style={{ color: "var(--accent)" }}>{formatInr(shown.get(component) ?? 0)}</span>
              </span>
            </summary>
            <div className="border-t p-4" style={{ borderColor: "var(--hairline)" }}>
              <div className="mb-2 flex gap-4 text-xs">
                <button type="button" disabled={disabled || !g.off.length} onClick={() => setKeys(g.off.map((i) => i.key), false)} className="underline disabled:opacity-40">
                  Include all
                </button>
                <button type="button" disabled={disabled || !g.on.length} onClick={() => setKeys(g.on.map((i) => i.key), true)} className="underline disabled:opacity-40">
                  Remove all
                </button>
              </div>
              <ul className="flex flex-col divide-y" style={{ borderColor: "var(--hairline)" }}>
                {all.map((item) => {
                  const included = !off.includes(item);
                  return (
                    <li key={item.key} className="py-2">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={included}
                          disabled={disabled}
                          onChange={() => setKeys([item.key], included)}
                        />
                        <span className="min-w-0 flex-1" style={included ? undefined : { opacity: 0.5, textDecoration: "line-through" }}>
                          <span className="block text-sm">{item.label}</span>
                          <span className="block text-xs" style={{ color: "var(--muted)" }}>
                            {item.detail} · {item.quantity} × {formatInr(item.unitPriceInr)}
                            {item.source === "estimated" ? " · estimated" : ""}
                          </span>
                        </span>
                        <span className="text-sm tabular-nums" style={included ? undefined : { opacity: 0.5, textDecoration: "line-through" }}>
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
