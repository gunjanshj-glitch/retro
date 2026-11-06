"use client";

/**
 * Admin-only price split. Shows every charge behind each category the traveller
 * sees (airport transfers, sightseeing transport, entrances, and so on) and
 * gives the agency complete control over each one:
 *
 *  - switch a line off or back on (dropped from the total, with contingency,
 *    margin and tax recomputed);
 *  - replace its rate or quantity with the real figure, until the engine's
 *    rates are accurate enough to trust (the engine's own number stays visible
 *    next to it, with a one-click reset);
 *  - add a charge the engine has no card for.
 *
 * Rupees typed here are the agency's own cost. The traveller's quote page only
 * ever shows the category totals, never these lines.
 */
import { formatInr } from "@retro/core/atlas/engine/text";
import type { CostComponent, LineItem, LineOverride, QuoteRequest, Quotation } from "@retro/core/atlas/engine/types";
import { COMPONENT_LABEL, componentBreakdown } from "@retro/core/quote-pricing";
import { btnSmall } from "@/components/plan/theme";

type Props = {
  quote: Quotation;
  onChange: (next: (r: QuoteRequest) => QuoteRequest) => void;
  disabled?: boolean;
};

const MAX_CUSTOM_LINES = 50;

/** Components an admin can add a charge to, in the order the traveller's page lists them. */
const ADDABLE: CostComponent[] = [
  "hotel",
  "flight",
  "airport-transfer",
  "local-transport",
  "ground-transport",
  "intercity-transport",
  "sightseeing",
  "meals",
  "visa",
  "insurance",
  "city-tax",
];

const compactField =
  "h-9 rounded-lg border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] px-2 text-right text-sm tabular-nums text-[var(--ink)] outline-none transition-colors hover:border-[var(--ink-2)] focus:border-[var(--ink)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--sun)_35%,transparent)] disabled:opacity-60";

function newId(): string {
  return `c${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A number the admin types and commits on Enter or blur, so the itinerary is
 * re-priced once per edit rather than once per keystroke. Anything that is not
 * a number at least `min` snaps back to the last good value. The parent keys
 * it by value, so an outside change (a reset) shows up straight away.
 */
function NumField({
  value,
  min = 0,
  onCommit,
  label,
  className = "w-24",
  disabled,
}: {
  value: number;
  min?: number;
  onCommit: (n: number) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={String(value)}
      disabled={disabled}
      aria-label={label}
      className={`${compactField} ${className}`}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = String(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const raw = e.currentTarget.value.replace(/[,₹\s]/g, "");
        const n = Number(raw);
        if (raw === "" || !Number.isFinite(n) || n < min) {
          e.currentTarget.value = String(value);
          return;
        }
        // Whole rupees; quantities may carry a fraction (half-day, 0.5 head).
        const next = Math.round(n * 100) / 100;
        if (next !== value) onCommit(next);
        else e.currentTarget.value = String(value);
      }}
    />
  );
}

/** Free text committed on blur, with the same snap-back rule for an empty value. */
function TextField({ value, onCommit, label, disabled }: { value: string; onCommit: (s: string) => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="text"
      defaultValue={value}
      maxLength={120}
      disabled={disabled}
      aria-label={label}
      className={`${compactField} min-w-0 flex-1 text-left`}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (!next) e.currentTarget.value = value;
        else if (next !== value) onCommit(next);
      }}
    />
  );
}

export function PriceSplitPanel({ quote, onChange, disabled }: Props) {
  const active = quote.lineItems;
  const off = quote.excludedLineItems ?? [];
  const shown = new Map(componentBreakdown(quote, quote.totals.total).map((r) => [r.key, r.amountInr]));
  const overrides = quote.request.lineOverrides;
  const customCount = quote.request.customLines.length;

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

  // An override whose line no longer exists (the hotel class or a destination
  // changed, so the line has a new name) does nothing; say so rather than hide it.
  const liveKeys = new Set([...active, ...off].map((i) => i.key));
  const staleKeys = Object.keys(overrides).filter((k) => !liveKeys.has(k));

  const setKeys = (keys: string[], switchOff: boolean) =>
    onChange((r) => {
      const next = new Set(r.excludedLineKeys);
      for (const k of keys) {
        if (switchOff) next.add(k);
        else next.delete(k);
      }
      return { ...r, excludedLineKeys: [...next] };
    });

  /** Replace a line's rate and/or quantity. Values equal to the engine's own are dropped, so "no override" stays truly empty. */
  const setOverride = (item: LineItem, patch: LineOverride) =>
    onChange((r) => {
      const engine = item.override ?? { unitPriceInr: item.unitPriceInr, quantity: item.quantity };
      const merged: LineOverride = { ...r.lineOverrides[item.key], ...patch };
      if (merged.unitPriceInr === engine.unitPriceInr) delete merged.unitPriceInr;
      if (merged.quantity === engine.quantity) delete merged.quantity;
      const next = { ...r.lineOverrides };
      if (merged.unitPriceInr === undefined && merged.quantity === undefined) delete next[item.key];
      else next[item.key] = merged;
      return { ...r, lineOverrides: next };
    });

  const clearOverrides = (keys: string[]) =>
    onChange((r) => {
      const next = { ...r.lineOverrides };
      for (const k of keys) delete next[k];
      return { ...r, lineOverrides: next };
    });

  const addCustom = (component: CostComponent) =>
    onChange((r) =>
      r.customLines.length >= MAX_CUSTOM_LINES
        ? r
        : { ...r, customLines: [...r.customLines, { id: newId(), component, label: "Additional charge", quantity: 1, unitPriceInr: 1000 }] },
    );

  const editCustom = (id: string, patch: Partial<{ label: string; quantity: number; unitPriceInr: number }>) =>
    onChange((r) => ({ ...r, customLines: r.customLines.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const removeCustom = (id: string) =>
    onChange((r) => ({
      ...r,
      customLines: r.customLines.filter((c) => c.id !== id),
      excludedLineKeys: r.excludedLineKeys.filter((k) => k !== `custom|${id}`),
    }));

  const removed = off.reduce((s, i) => s + i.totalInr, 0);
  const editedKeys = Object.keys(overrides).filter((k) => liveKeys.has(k));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Every charge in the quote is here. <strong style={{ color: "var(--ink)" }}>Tick</strong> a line to charge for it,{" "}
        <strong style={{ color: "var(--ink)" }}>type</strong> the quantity or rate to replace the engine&apos;s figure with the real one, or{" "}
        <strong style={{ color: "var(--ink)" }}>add a charge</strong> the engine doesn&apos;t know about. Amounts are your cost; margin and tax are added on top. Travellers see only the category totals.
      </p>

      {(off.length > 0 || editedKeys.length > 0 || customCount > 0) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 text-sm font-semibold" style={{ borderColor: "color-mix(in srgb, var(--warning) 25%, transparent)", background: "var(--warning-soft)", color: "var(--warning)" }}>
          {editedKeys.length > 0 && <span>{editedKeys.length} rate{editedKeys.length === 1 ? "" : "s"} edited</span>}
          {customCount > 0 && <span>{customCount} charge{customCount === 1 ? "" : "s"} added</span>}
          {off.length > 0 && (
            <span>
              {off.length} line{off.length === 1 ? "" : "s"} switched off ({formatInr(removed)} of base cost)
            </span>
          )}
          {editedKeys.length > 0 && (
            <button type="button" disabled={disabled} onClick={() => clearOverrides(editedKeys)} className={`${btnSmall} ml-auto`}>
              Reset all edited rates
            </button>
          )}
        </p>
      )}

      {staleKeys.length > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink-2)" }}>
          <span>
            {staleKeys.length} edited rate{staleKeys.length === 1 ? "" : "s"} no longer match any line (the trip changed, so the line was renamed or removed) and {staleKeys.length === 1 ? "is" : "are"} ignored.
          </span>
          <button type="button" disabled={disabled} onClick={() => clearOverrides(staleKeys)} className={btnSmall}>
            Clear {staleKeys.length === 1 ? "it" : "them"}
          </button>
        </p>
      )}

      {rows.map(([component, g]) => {
        const base = g.on.reduce((s, i) => s + i.totalInr, 0);
        const all = [...g.on, ...g.off];
        return (
          <details key={component} className="group rounded-xl border bg-[var(--card)]" style={{ borderColor: "var(--line)" }} open={all.length <= 6}>
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
                <button type="button" disabled={disabled || customCount >= MAX_CUSTOM_LINES} onClick={() => addCustom(component as CostComponent)} className={`${btnSmall} sm:ml-auto`}>
                  + Add a charge
                </button>
              </div>
              <ul className="flex flex-col divide-y divide-[var(--line)]">
                {all.map((item) => {
                  const included = !off.includes(item);
                  const struck = included ? undefined : { color: "var(--ink-2)", textDecoration: "line-through" };
                  const customId = item.custom ? item.key.slice("custom|".length) : null;
                  const edited = item.override != null;
                  return (
                    <li key={item.key} className="flex items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                        checked={included}
                        disabled={disabled}
                        onChange={() => setKeys([item.key], included)}
                        aria-label={`Charge for ${item.label}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          {customId ? (
                            <TextField key={item.label} value={item.label} label="Description of the added charge" disabled={disabled} onCommit={(label) => editCustom(customId, { label })} />
                          ) : (
                            <span className="block text-sm" style={struck}>
                              {item.label}
                              {edited && (
                                <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "var(--coral-soft)", color: "var(--accent)" }}>
                                  edited
                                </span>
                              )}
                            </span>
                          )}
                          <span className="ml-auto text-sm font-semibold tabular-nums" style={struck}>
                            {formatInr(item.totalInr)}
                          </span>
                        </div>
                        {!customId && (
                          <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                            {item.detail}
                            {item.source === "estimated" ? " · estimated" : ""}
                          </span>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs" style={{ color: "var(--muted)" }}>
                          <NumField
                            key={`q${item.quantity}`}
                            value={item.quantity}
                            min={customId ? 0.01 : 0}
                            disabled={disabled}
                            label={`Quantity for ${item.label}`}
                            className="w-16"
                            onCommit={(n) => (customId ? editCustom(customId, { quantity: n }) : setOverride(item, { quantity: n }))}
                          />
                          <span aria-hidden="true">×</span>
                          <span className="flex items-center gap-1">
                            <span aria-hidden="true">₹</span>
                            <NumField
                              key={`u${item.unitPriceInr}`}
                              value={item.unitPriceInr}
                              min={customId ? 1 : 0}
                              disabled={disabled}
                              label={`Rate in rupees for ${item.label}`}
                              className="w-28"
                              onCommit={(n) => (customId ? editCustom(customId, { unitPriceInr: n }) : setOverride(item, { unitPriceInr: n }))}
                            />
                          </span>
                          {edited && (
                            <>
                              <span>
                                engine said {item.override!.quantity} × {formatInr(item.override!.unitPriceInr)}
                              </span>
                              <button type="button" disabled={disabled} onClick={() => clearOverrides([item.key])} className="min-h-9 px-1 font-semibold underline underline-offset-2 hover:text-[var(--ink)]">
                                Reset
                              </button>
                            </>
                          )}
                          {customId && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => removeCustom(customId)}
                              className="ml-auto min-h-9 px-1 font-semibold underline underline-offset-2 hover:text-[var(--danger)]"
                            >
                              Remove charge
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3 text-sm" style={{ borderColor: "var(--line-strong)" }}>
        <label htmlFor="add-charge-category" className="font-semibold">
          Add a charge to
        </label>
        <select
          id="add-charge-category"
          disabled={disabled || customCount >= MAX_CUSTOM_LINES}
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            addCustom(e.target.value as CostComponent);
            e.target.value = "";
          }}
          className="h-9 rounded-lg border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] px-2 text-sm text-[var(--ink)]"
        >
          <option value="">Choose a category…</option>
          {ADDABLE.map((c) => (
            <option key={c} value={c}>
              {COMPONENT_LABEL[c] ?? c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
