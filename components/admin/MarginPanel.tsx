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
import type { Quotation } from "@retro/core/atlas/engine/types";
import { summariseMargin, type QuoteAdjustments } from "@retro/core/quote-pricing";
import { toneStyle } from "@/components/plan/theme";

type Props = {
  quote: Quotation;
  adjustments: QuoteAdjustments;
};

const pct = (n: number | null) => (n == null ? "–" : `${(n * 100).toFixed(1)}%`);
const signed = (n: number) => (n === 0 ? formatInr(0) : `${n > 0 ? "+" : "−"}${formatInr(Math.abs(n))}`);

const SOURCE_LABEL: Record<string, string> = {
  live: "live from a supplier feed",
  workbook: "from your contracted rate card",
  estimated: "estimated (no contracted rate yet)",
  manual: "set by hand",
};

export function MarginPanel({ quote, adjustments }: Props) {
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

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--line)" }}>
        <table className="w-full border-collapse text-[13px] sm:text-sm">
          <caption className="sr-only">Cost, agency cut and traveller price by category</caption>
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--muted)", background: "var(--surface)" }}>
              <th scope="col" className="px-2 py-2 sm:px-3.5 font-semibold">Category</th>
              <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Your cost</th>
              <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Agency cut</th>
              <th scope="col" className="px-2 py-2 sm:px-3.5 text-right font-semibold">Traveller sees</th>
            </tr>
          </thead>
          <tbody className="whitespace-nowrap tabular-nums">
            {m.categories.map((c) => (
              <tr key={c.key} className="border-t" style={{ borderColor: "var(--line)" }}>
                <th scope="row" className="whitespace-normal px-2 py-2 sm:px-3.5 text-left font-normal">{c.label}</th>
                <td className="px-2 py-2 sm:px-3.5 text-right">{formatInr(c.costInr)}</td>
                <td className="px-2 py-2 sm:px-3.5 text-right" style={{ color: c.cutInr < 0 ? "var(--danger)" : "var(--ink-2)" }}>{signed(c.cutInr)}</td>
                <td className="px-2 py-2 sm:px-3.5 text-right font-semibold">{formatInr(c.sellInr)}</td>
              </tr>
            ))}
            {m.taxInr > 0 && (
              <tr className="border-t" style={{ borderColor: "var(--line)" }}>
                <th scope="row" className="whitespace-normal px-2 py-2 text-left font-normal sm:px-3.5">GST &amp; fees <span className="text-xs" style={{ color: "var(--muted)" }}>(not yours to keep)</span></th>
                <td className="px-2 py-2 sm:px-3.5 text-right">–</td>
                <td className="px-2 py-2 sm:px-3.5 text-right">–</td>
                <td className="px-2 py-2 sm:px-3.5 text-right font-semibold">{formatInr(m.taxInr)}</td>
              </tr>
            )}
            {m.extrasInr !== 0 && (
              <tr className="border-t" style={{ borderColor: "var(--line)" }}>
                <th scope="row" className="whitespace-normal px-2 py-2 text-left font-normal sm:px-3.5">Extra lines <span className="text-xs" style={{ color: "var(--muted)" }}>(charges less discounts)</span></th>
                <td className="px-2 py-2 sm:px-3.5 text-right">–</td>
                <td className="px-2 py-2 sm:px-3.5 text-right">{signed(m.extrasInr)}</td>
                <td className="px-2 py-2 sm:px-3.5 text-right font-semibold">{signed(m.extrasInr)}</td>
              </tr>
            )}
          </tbody>
          <tfoot className="whitespace-nowrap tabular-nums">
            <tr className="border-t-2 font-bold" style={{ borderColor: "var(--line-strong)" }}>
              <th scope="row" className="px-2 py-2.5 sm:px-3.5 text-left">Total</th>
              <td className="px-2 py-2.5 sm:px-3.5 text-right">{formatInr(m.costInr)}</td>
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
