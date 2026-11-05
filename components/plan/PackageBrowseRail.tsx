"use client";

/**
 * Continuously auto-scrolling rail of every sellable package, in the same
 * visual style as `components/destinations/PackagesRow.tsx` (the row shown
 * on each destination's own page) — reused directly here rather than
 * restyled, so a card looks identical wherever the traveller meets it.
 *
 * Unlike that row, this one moves on its own: the track is duplicated and
 * slid by exactly one copy's width in a seamless CSS loop, pausing on
 * hover/focus so a card can actually be read and clicked. A traveller who
 * prefers reduced motion gets an ordinary manually-scrollable row instead
 * (see `usePrefersReducedMotion`) — the animation never runs for them at all,
 * rather than merely running slower.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadPackageCards, type PackageCard } from "@/lib/atlas/client";
import { usePrefersReducedMotion } from "@/lib/reduced-motion";
import { useHorizontalScroll } from "@/lib/use-horizontal-scroll";
import { ScrollArrowButton } from "@/components/ui/ScrollArrowButton";
import { formatInr } from "@retro/core/atlas/engine/text";

/** Roughly 4.5s per card keeps the loop leisurely enough to read a card in
 *  passing without the row feeling static. */
const SECONDS_PER_CARD = 4.5;

function Card({ pkg, inert }: { pkg: PackageCard; inert?: boolean }) {
  return (
    <Link
      href={`/destinations/${pkg.destinationSlug}/packages/${pkg.slug}`}
      tabIndex={inert ? -1 : undefined}
      className="group flex w-52 shrink-0 flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] duration-200 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow)] sm:w-60"
      style={{ background: "var(--card)", borderColor: "var(--line)" }}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <img
          src={pkg.coverImage}
          alt={pkg.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {pkg.priceFromInr > 0 && (
          <div
            className="absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums shadow-[0_2px_8px_rgba(11,34,56,0.18)]"
            style={{ background: "var(--sun)", color: "var(--on-sun)" }}
          >
            from {formatInr(pkg.priceFromInr)}
            {!pkg.priceIncludesFlight && (
              <span className="font-semibold opacity-75"> + flights</span>
            )}
          </div>
        )}
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: "rgba(11,34,56,0.32)" }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ background: "var(--sun)", color: "var(--on-sun)" }}
          >
            View package
            <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-lg leading-tight">{pkg.name}</h3>
        {pkg.tagline && (
          <p className="mt-1 line-clamp-3 text-xs leading-snug" style={{ color: "var(--muted)" }}>
            {pkg.tagline}
          </p>
        )}
        <p className="mt-auto pt-3 text-xs font-semibold" style={{ color: "var(--ink)" }}>
          {pkg.nights > 0 ? `${pkg.nights}N / ${pkg.days}D` : "Flexible"}
        </p>
      </div>
    </Link>
  );
}

/** Manually scrollable row with prev/next arrows. Mounted only once the cards
 *  exist, so `useHorizontalScroll` finds its scroller on first effect run and
 *  keeps the arrows' disabled state in sync. */
function ManualRail({ cards, startNudge }: { cards: PackageCard[]; startNudge?: 1 | -1 }) {
  const { scrollerRef, atStart, atEnd, nudge } = useHorizontalScroll<HTMLDivElement>();

  useEffect(() => {
    if (startNudge) nudge(startNudge);
    // Only the initial hand-off from the auto-scrolling rail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-2">
      <ScrollArrowButton dir="left" onClick={() => nudge(-1)} disabled={atStart} label="Scroll packages left" />
      <div ref={scrollerRef} className="no-scrollbar flex flex-1 gap-4 overflow-x-auto scroll-smooth py-2" role="list">
        {cards.map((pkg) => (
          <div key={pkg.id} role="listitem" className="contents">
            <Card pkg={pkg} />
          </div>
        ))}
      </div>
      <ScrollArrowButton dir="right" onClick={() => nudge(1)} disabled={atEnd} label="Scroll packages right" />
    </div>
  );
}

export function PackageBrowseRail() {
  const [cards, setCards] = useState<PackageCard[] | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  // Set once the traveller uses an arrow: the auto-scrolling loop hands over
  // to the manual row (same cards, same arrows) and stays there.
  const [manualDir, setManualDir] = useState<1 | -1 | null>(null);

  useEffect(() => {
    loadPackageCards()
      .then(setCards)
      .catch(() => setCards([]));
  }, []);

  if (!cards || !cards.length) return null;

  const heading = (
    <div className="flex flex-col gap-1">
      <p className="eyebrow">All packages</p>
      <h2 className="font-display text-2xl md:text-3xl">Or start from a ready-made trip</h2>
    </div>
  );

  if (reduceMotion || manualDir) {
    // No duplicated track: without the animation a doubled list would just
    // look like every package appearing twice.
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <ManualRail cards={cards} startNudge={manualDir ?? undefined} />
      </div>
    );
  }

  const duration = cards.length * SECONDS_PER_CARD;

  return (
    <div className="flex flex-col gap-4">
      {heading}
      <div className="flex items-center gap-2">
        <ScrollArrowButton dir="left" onClick={() => setManualDir(-1)} disabled={false} label="Scroll packages left" />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className="marquee-track flex w-max gap-4 py-2"
            style={{ "--marquee-duration": `${duration}s` } as React.CSSProperties}
            role="list"
            aria-label="All packages"
          >
            {/* The track is rendered twice back-to-back and slid by exactly one
                copy's width (translateX(-50%)), which is what makes the loop
                seamless — the second copy is aria-hidden so the list isn't
                announced twice to assistive tech. */}
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-4" aria-hidden={copy === 1 ? true : undefined}>
                {cards.map((pkg) => (
                  <div key={`${copy}-${pkg.id}`} role={copy === 0 ? "listitem" : undefined} className="contents">
                    <Card pkg={pkg} inert={copy === 1} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <ScrollArrowButton dir="right" onClick={() => setManualDir(1)} disabled={false} label="Scroll packages right" />
      </div>
    </div>
  );
}
