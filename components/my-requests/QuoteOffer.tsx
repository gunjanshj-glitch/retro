"use client";

/**
 * A final quote as the traveller sees it: itinerary, what is included, a price
 * breakdown, any discounts or extra charges, optional extras they can tick, and
 * the total. The same component renders the agency's preview in the quote
 * editor, so what they check is what gets sent.
 *
 * Pure presentation over a `PublicQuote` — prices come from `priceQuote`, the
 * same function the Worker uses when the quote is accepted and charged.
 */
import { useMemo } from "react";
import { formatDuration, formatInr } from "@retro/core/atlas/engine/text";
import { priceQuote, type PublicQuote } from "@retro/core/quote-pricing";
import { daysLeft, daysLeftLabel, formatDate } from "./status";
import { cardClass, optionCardStyle } from "@/components/plan/theme";

const MEAL_PLAN: Record<string, string> = {
  breakfast: "Breakfast daily",
  "half-board": "Breakfast & dinner daily",
  "full-board": "All meals",
};

type Props = {
  quote: PublicQuote;
  selected: string[];
  /** Absent means read-only (preview, or a quote already accepted). */
  onSelectedChange?: (ids: string[]) => void;
  version?: number;
};

export function QuoteOffer({ quote, selected, onSelectedChange, version }: Props) {
  // `packageInr` is already the resolved package price (engine total or the
  // agency's pinned figure), so it is passed as the base with nothing pinned.
  const priced = useMemo(
    () => priceQuote(quote.packageInr, { fixedPackageInr: null, lines: quote.lines, depositInr: quote.depositInr }, selected),
    [quote, selected],
  );

  const mandatory = quote.lines.filter((l) => !l.optional);
  const optional = quote.lines.filter((l) => l.optional);
  const left = daysLeft(quote.validUntil);
  const interactive = Boolean(onSelectedChange);

  const toggle = (id: string) => {
    if (!onSelectedChange) return;
    onSelectedChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const includes = [
    `${quote.nights} nights · ${quote.includes.hotelStar} hotels`,
    MEAL_PLAN[quote.includes.mealPlan] ?? quote.includes.mealPlan,
    "Airport & intercity transfers, sightseeing as per itinerary",
    quote.includes.flights ? `Return flights from ${quote.includes.departureCity}` : "Flights not included",
    quote.includes.visa ? "Visa support" : "Visa not included",
    quote.includes.insurance ? "Travel insurance" : "Travel insurance not included",
  ];

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-3xl border p-5 shadow-[var(--shadow)] sm:p-7"
        style={{
          borderColor: "var(--line)",
          background:
            "radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--sun) 22%, transparent) 0%, transparent 55%), var(--card)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Final quote{version ? ` · v${version}` : ""}</p>
            <h2 className="font-display mt-2 text-3xl">{quote.title}</h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
              {quote.nights} nights from {formatDate(quote.startDate)} · {quote.pax.adults} adult{quote.pax.adults !== 1 && "s"}
              {quote.pax.children > 0 && `, ${quote.pax.children} child${quote.pax.children !== 1 ? "ren" : ""}`}
              {quote.pax.infants > 0 && `, ${quote.pax.infants} infant${quote.pax.infants !== 1 ? "s" : ""}`} · {quote.pax.rooms} room
              {quote.pax.rooms !== 1 && "s"}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
              Total
            </p>
            <p className="font-display text-4xl tabular-nums" style={{ color: "var(--ink)" }}>
              {formatInr(priced.totalInr)}
            </p>
            {quote.depositInr != null && quote.depositInr < priced.totalInr && (
              <p className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                {formatInr(priced.dueNowInr)} now to confirm · balance later
              </p>
            )}
          </div>
        </div>
        {quote.note && (
          <p className="mt-5 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--ink-2)" }}>
              A note from our team
            </span>
            {quote.note}
          </p>
        )}
        <p
          className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-xs ${left != null && left <= 2 ? "font-bold" : "font-medium"}`}
          style={
            left != null && left <= 2
              ? { background: "var(--warning-soft)", color: "var(--warning)" }
              : { background: "var(--surface)", color: "var(--ink-2)" }
          }
        >
          Valid until {formatDate(quote.validUntil)}
          {left != null && ` (${daysLeftLabel(left)})`}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-display text-2xl">What&apos;s included</h3>
        <ul className={`${cardClass} grid gap-x-6 gap-y-2.5 p-5 text-sm sm:grid-cols-2`}>
          {includes.map((line) => {
            const excluded = line.includes("not included");
            return (
              <li key={line} className="flex items-start gap-2.5" style={{ color: excluded ? "var(--ink-2)" : "var(--ink)" }}>
                <span
                  aria-hidden="true"
                  className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={excluded ? { background: "var(--surface)", color: "var(--ink-2)" } : { background: "var(--success-soft)", color: "var(--success)" }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    {excluded ? (
                      <path d="M6 12h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    ) : (
                      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </span>
                {line}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-display text-2xl">Price breakdown</h3>
        <div className={`${cardClass} overflow-hidden`}>
          {quote.breakdown.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm last:border-b-0" style={{ borderColor: "var(--line)" }}>
              <span>{row.label}</span>
              <span className="tabular-nums">{formatInr(row.amountInr)}</span>
            </div>
          ))}
          {mandatory.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm last:border-b-0" style={{ borderColor: "var(--line)" }}>
              <span>{line.label}</span>
              <span className="tabular-nums" style={{ color: line.amountInr < 0 ? "var(--success)" : undefined, fontWeight: line.amountInr < 0 ? 600 : undefined }}>
                {line.amountInr < 0 ? "−" : ""}
                {formatInr(Math.abs(line.amountInr))}
              </span>
            </div>
          ))}
        </div>
      </section>

      {optional.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-display text-2xl">Optional extras</h3>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {interactive ? "Add any of these — the total updates as you choose." : "Offered with this quote."}
          </p>
          <ul className="flex flex-col gap-2">
            {optional.map((line) => {
              const on = selected.includes(line.id);
              return (
                <li key={line.id}>
                  <label
                    className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border-[1.5px] px-4 py-3 text-sm ${interactive ? "cursor-pointer hover:border-[var(--line-strong)]" : ""}`}
                    style={optionCardStyle(on)}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!interactive}
                        onChange={() => toggle(line.id)}
                        className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                      />
                      {line.label}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">+ {formatInr(line.amountInr)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <dl className="ml-auto flex w-full max-w-sm flex-col gap-1 text-sm">
        {priced.optionalsInr > 0 && (
          <div className="flex justify-between">
            <dt style={{ color: "var(--muted)" }}>Optional extras</dt>
            <dd className="tabular-nums">{formatInr(priced.optionalsInr)}</dd>
          </div>
        )}
        <div className="mt-1 flex items-baseline justify-between border-t pt-3" style={{ borderColor: "var(--line-strong)" }}>
          <dt className="font-bold">Total payable</dt>
          <dd className="font-display text-2xl tabular-nums" style={{ color: "var(--ink)" }}>
            {formatInr(priced.totalInr)}
          </dd>
        </div>
        {priced.dueNowInr < priced.totalInr && (
          <>
            <div className="flex justify-between">
              <dt style={{ color: "var(--muted)" }}>Due now to confirm</dt>
              <dd className="tabular-nums">{formatInr(priced.dueNowInr)}</dd>
            </div>
            <div className="flex justify-between">
              <dt style={{ color: "var(--muted)" }}>Balance</dt>
              <dd className="tabular-nums">{formatInr(priced.totalInr - priced.dueNowInr)}</dd>
            </div>
          </>
        )}
      </dl>

      <section className="flex flex-col gap-3">
        <h3 className="font-display text-2xl">Your itinerary</h3>
        <ol className="flex flex-col gap-2">
          {quote.days.map((day) => (
            <li key={day.dayNumber} className={`${cardClass} p-4 text-sm`}>
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  Day {day.dayNumber} · {day.placeName}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatDate(day.date)}
                </span>
              </p>
              {day.transfer && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                  {day.transfer.from} → {day.transfer.to} by {day.transfer.mode.replace(/-/g, " ")}
                  {day.transfer.durationMinutes ? ` · ${formatDuration(day.transfer.durationMinutes)}` : ""}
                </p>
              )}
              {day.activities.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1" style={{ color: "var(--ink-2)" }}>
                  {day.activities.map((a, i) => (
                    <li key={`${a.title}-${i}`} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
                      {a.title}
                    </li>
                  ))}
                </ul>
              ) : (
                !day.transfer && (
                  <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                    A free day to explore at your own pace.
                  </p>
                )
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
