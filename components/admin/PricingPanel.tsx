"use client";

/**
 * The commercial controls of the quote editor: pin a negotiated package price,
 * add charges or discounts, offer optional extras, take a deposit, set how long
 * the quote stays open and what the traveller is told. Pure form over
 * `QuoteAdjustments` — the maths lives in lib/quote-pricing.ts.
 */
import { useState } from "react";
import { formatInr } from "@retro/core/atlas/engine/text";
import { priceQuote, type CustomLine, type QuoteAdjustments } from "@retro/core/quote-pricing";
import { btnSmall, fieldClass, selectStyle } from "@/components/plan/theme";

const inputClass = fieldClass;

type LineKind = "charge" | "discount" | "optional";

const kindOf = (l: CustomLine): LineKind => (l.optional ? "optional" : l.amountInr < 0 ? "discount" : "charge");

function newId(): string {
  return `l${Math.random().toString(36).slice(2, 10)}`;
}

type Props = {
  engineTotalInr: number;
  adjustments: QuoteAdjustments;
  onChange: (next: QuoteAdjustments) => void;
  validUntil: string;
  onValidUntilChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  disabled?: boolean;
};

export function PricingPanel({ engineTotalInr, adjustments, onChange, validUntil, onValidUntilChange, note, onNoteChange, disabled }: Props) {
  const priced = priceQuote(engineTotalInr, adjustments);
  // Fixed at mount: the date limits shouldn't shift under an open form.
  const [{ today, max }] = useState(() => ({
    today: new Date().toISOString().slice(0, 10),
    max: new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10),
  }));

  const setLine = (id: string, patch: Partial<CustomLine> & { kind?: LineKind; abs?: number }) =>
    onChange({
      ...adjustments,
      lines: adjustments.lines.map((l) => {
        if (l.id !== id) return l;
        const kind = patch.kind ?? kindOf(l);
        const abs = patch.abs ?? Math.abs(l.amountInr);
        return {
          ...l,
          label: patch.label ?? l.label,
          optional: kind === "optional",
          amountInr: kind === "discount" ? -abs : abs,
        };
      }),
    });

  const addLine = (kind: LineKind) =>
    onChange({
      ...adjustments,
      lines: [...adjustments.lines, { id: newId(), label: "", amountInr: kind === "discount" ? -1 : 1, optional: kind === "optional" }],
    });

  const removeLine = (id: string) => onChange({ ...adjustments, lines: adjustments.lines.filter((l) => l.id !== id) });

  const pinned = adjustments.fixedPackageInr != null;
  const deposit = adjustments.depositInr;

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-6 disabled:opacity-60">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl p-4" style={{ background: "var(--surface)" }}>
          <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--ink-2)" }}>
            Priced by the engine
          </p>
          <p className="mt-1 font-display text-2xl tabular-nums">{formatInr(engineTotalInr)}</p>
        </div>
        <label className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <span className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => onChange({ ...adjustments, fixedPackageInr: e.target.checked ? Math.round(engineTotalInr) : null })}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            Set a fixed package price
          </span>
          {pinned && (
            <input
              type="number"
              min={1}
              step={100}
              inputMode="numeric"
              value={adjustments.fixedPackageInr ?? ""}
              onChange={(e) => onChange({ ...adjustments, fixedPackageInr: e.target.value === "" ? null : Math.round(Number(e.target.value)) })}
              className={`${inputClass} mt-1.5`}
              aria-label="Fixed package price in rupees"
            />
          )}
          <span className="mt-1 block text-xs font-normal" style={{ color: "var(--muted)" }}>Overrides the engine total — use for a negotiated or rounded figure. The breakdown scales to match.</span>
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-lg">Charges, discounts &amp; optional extras</h4>
          <div className="flex flex-wrap gap-2">
            {(["charge", "discount", "optional"] as const).map((k) => (
              <button key={k} type="button" onClick={() => addLine(k)} className={`${btnSmall} min-h-10`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
                </svg>
                {k === "charge" ? "Charge" : k === "discount" ? "Discount" : "Optional extra"}
              </button>
            ))}
          </div>
        </div>
        {adjustments.lines.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            None yet. Optional extras are offered to the traveller as tick-boxes and only added to the total if they choose them.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {adjustments.lines.map((line) => {
            const kind = kindOf(line);
            return (
              <li key={line.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border p-3 sm:grid-cols-[9rem_1fr_9rem_auto]" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                <select
                  value={kind}
                  onChange={(e) => setLine(line.id, { kind: e.target.value as LineKind })}
                  className={`${inputClass} col-span-2 sm:col-span-1`}
                  style={selectStyle}
                  aria-label="Type"
                >
                  <option value="charge">Charge</option>
                  <option value="discount">Discount</option>
                  <option value="optional">Optional extra</option>
                </select>
                <input
                  value={line.label}
                  maxLength={120}
                  onChange={(e) => setLine(line.id, { label: e.target.value })}
                  placeholder={kind === "discount" ? "e.g. Early-bird discount" : kind === "optional" ? "e.g. Private Eiffel Tower dinner" : "e.g. Peak-season supplement"}
                  className={`${inputClass} col-span-2 sm:col-span-1`}
                  aria-label="Description"
                />
                <input
                  type="number"
                  min={1}
                  step={100}
                  inputMode="numeric"
                  value={Math.abs(line.amountInr)}
                  onChange={(e) => setLine(line.id, { abs: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                  className={inputClass}
                  aria-label="Amount in rupees"
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border-[1.5px] bg-[var(--card)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                  style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)" }}
                  aria-label="Remove line"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={deposit != null}
              onChange={(e) => onChange({ ...adjustments, depositInr: e.target.checked ? Math.max(1, Math.round(priced.totalInr * 0.25)) : null })}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            Take a deposit to confirm the booking
          </label>
          {deposit != null && (
            <>
              <input
                type="number"
                min={1}
                step={500}
                inputMode="numeric"
                value={deposit}
                onChange={(e) => onChange({ ...adjustments, depositInr: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                className={`${inputClass} mt-1.5`}
                aria-label="Deposit in rupees"
              />
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {[25, 30, 50].map((pct) => (
                  <button key={pct} type="button" onClick={() => onChange({ ...adjustments, depositInr: Math.round((priced.totalInr * pct) / 100) })} className={btnSmall}>
                    {pct}%
                  </button>
                ))}
              </span>
              {deposit >= priced.totalInr && (
                <span role="status" className="mt-1.5 block text-xs font-semibold" style={{ color: "var(--warning)" }}>
                  A deposit must be less than the total ({formatInr(priced.totalInr)}).
                </span>
              )}
            </>
          )}
          <span className="mt-1 block text-xs font-normal" style={{ color: "var(--muted)" }}>The balance is requested after the first payment. Leave off to take everything up front.</span>
        </div>
        <label className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          Quote stays open until
          <input type="date" value={validUntil} min={today} max={max} onChange={(e) => onValidUntilChange(e.target.value)} className={`${inputClass} mt-1.5 font-normal`} style={selectStyle} />
          <span className="mt-1 block text-xs font-normal" style={{ color: "var(--muted)" }}>After this date the traveller can no longer accept it.</span>
        </label>
      </div>

      <label className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        Note to the traveller (shown on the quote and in the email)
        <textarea value={note} maxLength={1500} rows={3} onChange={(e) => onNoteChange(e.target.value)} className={`${inputClass} mt-1.5 font-normal`} placeholder="e.g. As discussed on our call, I've upgraded the Rome hotel and added the private Vatican tour as an option." />
      </label>
    </fieldset>
  );
}
