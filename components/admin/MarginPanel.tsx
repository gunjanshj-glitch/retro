"use client";

/**
 * Admin-only: what the trip actually costs and what the agency keeps.
 *
 * The traveller's quote page folds contingency and margin into every category
 * so no single row looks marked up. That is right for them and useless for the
 * agency, which needs to see its real cost and its real cut, per category and
 * overall. This lays the same arithmetic out openly. It updates as rates are
 * edited, lines are switched off, or a package price is pinned.
 */
import { formatInr } from "@retro/core/atlas/engine/text";
import type { Quotation, QuoteRequest } from "@retro/core/atlas/engine/types";
import { summariseMargin, type QuoteAdjustments } from "@retro/core/quote-pricing";
import { btnSmall, toneStyle } from "@/components/plan/theme";

type Props = {
  quote: Quotation;
  adjustments: QuoteAdjustments;
  /** The trip being quoted. With `onChange`, margins become editable. */
  request?: QuoteRequest;
  onChange?: (next: (r: QuoteRequest) => QuoteRequest) => void;
  disabled?: boolean;
};

const pctField =
  "h-9 w-[4.5rem] rounded-lg border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] px-2 text-right text-sm tabular-nums text-[var(--ink)] outline-none transition-colors hover:border-[var(--ink-2)] focus:border-[var(--ink)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--sun)_35%,transparent)] disabled:opacity-60";

/**
 * A percentage the admin types, committed on Enter or blur so the trip is
 * re-priced once per edit. Shown to one decimal; junk snaps back.
 */
function PctField({ value, onCommit, label, disabled }: { value: number; onCommit: (pct: number) => void; label: string; disabled?: boolean }) {
  const shown = (Math.round(value * 10) / 10).toString();
  return (
    <input
      key={shown}
      type="text"
      inputMode="decimal"
      defaultValue={shown}
      disabled={disabled}
      aria-label={label}
      className={pctField}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = shown;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const n = Number(e.currentTarget.value.replace(/[%\s]/g, ""));
        if (e.currentTarget.value.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
          e.currentTarget.value = shown;
          return;
        }
        const next = Math.round(n * 10) / 10;
        if (next !== Math.round(value * 10) / 10) onCommit(next);
        else e.currentTarget.value = shown;
      }}
    />
  );
}

const pct = (n: number | null) => (n == null ? "–" : `${(n * 100).toFixed(1)}%`);
const signed = (n: number) => (n === 0 ? formatInr(0) : `${n > 0 ? "+" : "−"}${formatInr(Math.abs(n))}`);

const SOURCE_LABEL: Record<string, string> = {
  live: "live from a supplier feed",
  workbook: "from your contracted rate card",
  estimated: "estimated (no contracted rate yet)",
  manual: "set by hand",
};

export function MarginPanel({ quote, adjustments, request, onChange, disabled }: Props) {
  const m = summariseMargin(quote, adjustments);
  const loss = m.cutInr < 0;

  // How much of the cost rests on a real rate. Estimated lines are the ones to check first.
  const bySource = new Map<string, { n: number; inr: number }>();
  for (const l of quote.lineItems) {
    const e = bySource.get(l.source) ?? { n: 0, inr: 0 };
    e.n += 1;
    e.inr += l.totalInr;
    bySource.set(l.source, e);
  }
  const sources = (["live", "workbook", "estimated", "manual"] as const).filter((k) => bySource.has(k));

  const editable = !!request && !!onChange;
  const handSet = !!request && (request.marginPct != null || Object.keys(request.componentMarginPct).length > 0);
  const overallPct = m.costInr > 0 ? (m.marginInr / m.costInr) * 100 : 0;
  const setOverall = (pct: number) => onChange?.((r) => ({ ...r, marginPct: pct / 100 }));
  const setCategory = (key: string, pct: number | null) =>
    onChange?.((r) => {
      const next = { ...r.componentMarginPct };
      if (pct == null) delete next[key];
      else next[key] = pct / 100;
      return { ...r, componentMarginPct: next };
    });
  const resetMargins = () => onChange?.((r) => ({ ...r, marginPct: null, componentMarginPct: {} }));

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-3" aria-label="Cost and agency cut">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl p-3.5" style={{ background: "var(--surface)" }}>
          <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Actual cost</dt>
          <dd className="font-display text-2xl tabular-nums">{formatInr(m.costInr)}</dd>
          <p className="text-xs" style={{ color: "var(--muted)" }}>What suppliers charge, at the rates below.</p>
        </div>
        <div className="rounded-xl p-3.5" style={loss ? toneStyle.danger : { background: "var(--surface)" }}>
          <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: loss ? undefined : "var(--muted)" }}>Agency cut</dt>
          <dd className="font-display text-2xl tabular-nums">{signed(m.cutInr)}</dd>
          <p className="text-xs" style={{ color: loss ? undefined : "var(--muted)" }}>
            {pct(m.cutPct)} on cost{loss ? ". This quote loses money." : ""}
          </p>
        </div>
        <div className="rounded-xl p-3.5" style={{ background: "var(--surface)" }}>
          <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Traveller pays</dt>
          <dd className="font-display text-2xl tabular-nums">{formatInr(m.totalInr)}</dd>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Cost + cut + GST.</p>
        </div>
      </dl>

      {editable && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3.5 py-3 text-sm" style={{ borderColor: "var(--line)" }}>
          <label className="flex items-center gap-2 font-semibold">
            Margin on cost
            <PctField
              value={request!.marginPct != null ? request!.marginPct * 100 : overallPct}
              onCommit={setOverall}
              label="Margin on cost, percent, applied to every category without its own"
              disabled={disabled}
            />
            <span aria-hidden="true">%</span>
          </label>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {handSet ? "Set by you. Overrides the automatic margin." : "Automatic, from your pricing policy. Type a number to take control."}
          </span>
          {handSet && (
            <button type="button" disabled={disabled} onClick={resetMargins} className={`${btnSmall} ml-auto`}>
              Back to automatic
            </button>
          )}
          {m.flooredTo && !handSet && (
            <p className="basis-full text-xs" style={{ color: "var(--ink-2)" }}>
              The price is currently held at the published “from” price for {m.flooredTo}. Setting a margin turns that floor off, so the total will follow your margin instead, and may go down.
            </p>
          )}
          {adjustments.fixedPackageInr != null && (
            <p className="basis-full text-xs" style={{ color: "var(--danger)" }}>
              A package price is pinned, so the total will not move when you change margins. Clear the pinned price in section 6 to price from margin.
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--line)" }}>
        <table className="w-full border-collapse text-[13px] sm:text-sm">
          <caption className="sr-only">Cost, agency cut and traveller price by category</caption>
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--muted)", background: "var(--surface)" }}>
              <th scope="col" className="px-2 py-2 sm:px-3.5 font-semibold">Category</th>
              <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Your cost</th>
              {editable && <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Margin %</th>}
              <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Agency cut</th>
              <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Traveller sees</th>
            </tr>
          </thead>
          <tbody className="whitespace-nowrap tabular-nums">
            {m.categories.map((c) => (
              <tr key={c.key} className="border-t" style={{ borderColor: "var(--line)" }}>
                <th scope="row" className="whitespace-normal px-2 py-2 sm:px-3.5 text-left font-normal">{c.label}</th>
                <td className="px-2 py-2 sm:px-3.5 text-right">{formatInr(c.costInr)}</td>
                {editable && (
                  <td className="px-2 py-1.5 sm:px-3.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <PctField
                        value={(request!.componentMarginPct[c.key] != null ? request!.componentMarginPct[c.key] * 100 : c.marginPct ?? 0)}
                        onCommit={(n) => setCategory(c.key, n)}
                        label={`Margin on cost for ${c.label}, percent`}
                        disabled={disabled}
                      />
                      {request!.componentMarginPct[c.key] != null && (
                        <button type="button" disabled={disabled} onClick={() => setCategory(c.key, null)} aria-label={`Use the overall margin for ${c.label}`} className="px-1 text-base leading-none" style={{ color: "var(--muted)" }}>
                          ×
                        </button>
                      )}
                    </span>
                  </td>
                )}
                <td className="px-2 py-2 sm:px-3.5 text-right" style={{ color: c.cutInr < 0 ? "var(--danger)" : "var(--ink-2)" }}>{signed(c.cutInr)}</td>
                <td className="px-2 py-2 sm:px-3.5 text-right font-semibold">{formatInr(c.sellInr)}</td>
              </tr>
            ))}
            {m.taxInr > 0 && (
              <tr className="border-t" style={{ borderColor: "var(--line)" }}>
                <th scope="row" className="whitespace-normal px-2 py-2 text-left font-normal sm:px-3.5">GST &amp; fees <span className="text-xs" style={{ color: "var(--muted)" }}>(not yours to keep)</span></th>
                <td className="px-2 py-2 sm:px-3.5 text-right">–</td>
                {editable && <td />}
                <td className="px-2 py-2 sm:px-3.5 text-right">–</td>
                <td className="px-2 py-2 sm:px-3.5 text-right font-semibold">{formatInr(m.taxInr)}</td>
              </tr>
            )}
            {m.extrasInr !== 0 && (
              <tr className="border-t" style={{ borderColor: "var(--line)" }}>
                <th scope="row" className="whitespace-normal px-2 py-2 text-left font-normal sm:px-3.5">Extra lines <span className="text-xs" style={{ color: "var(--muted)" }}>(charges less discounts)</span></th>
                <td className="px-2 py-2 sm:px-3.5 text-right">–</td>
                {editable && <td />}
                <td className="px-2 py-2 sm:px-3.5 text-right">{signed(m.extrasInr)}</td>
                <td className="px-2 py-2 sm:px-3.5 text-right font-semibold">{signed(m.extrasInr)}</td>
              </tr>
            )}
          </tbody>
          <tfoot className="whitespace-nowrap tabular-nums">
            <tr className="border-t-2 font-bold" style={{ borderColor: "var(--line-strong)" }}>
              <th scope="row" className="px-2 py-2.5 sm:px-3.5 text-left">Total</th>
              <td className="px-2 py-2.5 sm:px-3.5 text-right">{formatInr(m.costInr)}</td>
              {editable && <td className="px-2 py-2.5 sm:px-3.5 text-right">{pct(m.costInr > 0 ? m.marginInr / m.costInr : null)}</td>}
              <td className="px-2 py-2.5 sm:px-3.5 text-right" style={{ color: loss ? "var(--danger)" : undefined }}>{signed(m.cutInr)}</td>
              <td className="px-2 py-2.5 sm:px-3.5 text-right">{formatInr(m.totalInr)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {sources.length > 0 && m.costInr > 0 && (
        <div className="rounded-xl border px-3.5 py-3 text-xs" style={{ borderColor: "var(--line)" }}>
          <p className="mb-1.5 font-semibold" style={{ color: "var(--ink)" }}>Where the cost comes from</p>
          <ul className="flex flex-col gap-1" style={{ color: "var(--muted)" }}>
            {sources.map((k) => {
              const e = bySource.get(k)!;
              return (
                <li key={k} className="flex justify-between gap-3">
                  <span>
                    {e.n} line{e.n === 1 ? "" : "s"} {SOURCE_LABEL[k]}
                  </span>
                  <span className="tabular-nums">
                    {formatInr(e.inr)} · {Math.round((e.inr / m.costInr) * 100)}%
                  </span>
                </li>
              );
            })}
          </ul>
          {quote.fx && quote.fx.length > 0 && (
            <p className="mt-2" style={{ color: "var(--muted)" }}>
              Rates quoted in {quote.fx.map((f) => f.currency).join(" and ")} are repriced at today&apos;s exchange rate (
              {quote.fx.map((f) => `${f.currency} ₹${f.liveInrPerUnit.toFixed(2)}, the card used ₹${f.cardInrPerUnit.toFixed(2)}`).join("; ")}).
            </p>
          )}
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        The cut is {formatInr(m.contingencyInr)} contingency (a buffer for supplier price moves) plus {signed(m.marginInr)} margin
        {m.extrasInr !== 0 ? ` plus ${signed(m.extrasInr)} from extra lines` : ""}. The traveller&apos;s page folds it into each category&apos;s price in proportion to its cost and never shows it on its own.
        {m.pinnedByInr !== 0 && ` The pinned package price moves the total ${signed(m.pinnedByInr)} from the calculated ${formatInr(m.packageInr - m.pinnedByInr)}, and that difference lands in the margin.`}
        {m.flooredTo && ` The calculated price was raised to the published “from” price for ${m.flooredTo}; the uplift is in the margin.`}
      </p>
    </div>
  );
}
