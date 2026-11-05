"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { HeroCard } from "@/lib/hero-card-picker";
import { useHorizontalScroll } from "@/lib/use-horizontal-scroll";
import { ScrollArrowButton } from "@/components/ui/ScrollArrowButton";

type Props = {
  cards: HeroCard[];
  activeIndex: number;
  onSelect: (index: number) => void;
};

// One card per region — text reads region on top, country (whichever one was
// randomly picked for that region on this page load) below. Each card links
// straight to that country's own place/package page.
export function CardRail({ cards, activeIndex, onSelect }: Props) {
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const isFirstRender = useRef(true);
  const { scrollerRef, atStart, atEnd, nudge } = useHorizontalScroll<HTMLDivElement>();

  useEffect(() => {
    // Skip on initial mount so the leading card isn't clipped; only react to
    // subsequent activeCardIndex changes (card clicks, video-ended auto-advance).
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Scroll ONLY the horizontal rail — never call scrollIntoView, which also
    // scrolls every ancestor (including the window) and would drag the whole
    // page down to the rail each time the active card changes.
    const scroller = scrollerRef.current;
    const card = cardRefs.current[activeIndex];
    if (!scroller || !card) return;
    const target = card.offsetLeft - (scroller.clientWidth - card.clientWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex, scrollerRef]);

  return (
    <div>
      <div className="mb-2 flex items-end justify-between px-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white">Popular Destinations</p>
        <Link
          href="/destinations"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-white underline-offset-4 hover:underline"
        >
          View all
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <ScrollArrowButton
          dir="left"
          onClick={() => nudge(-1, 260)}
          disabled={atStart}
          label="Scroll destinations left"
        />

        <div
          ref={scrollerRef}
          className="no-scrollbar flex min-w-0 flex-1 gap-3 overflow-x-auto scroll-smooth px-1 pb-2 pt-3 md:gap-4"
          role="list"
        >
          {cards.map((card, i) => {
            const isActive = i === activeIndex;
            const key = `${card.destinationSlug}-${card.placeSlug}`;
            const href = `/destinations/${card.destinationSlug}/packages/${card.packageSlug}`;
            return (
              <div key={key} role="listitem" className="contents">
                <Link
                  ref={(el) => {
                    cardRefs.current[i] = el;
                  }}
                  href={href}
                  aria-current={isActive ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(i);
                  }}
                  className="relative h-40 w-36 shrink-0 overflow-hidden rounded-2xl transition-[transform,box-shadow] duration-300 active:scale-[0.96] active:brightness-90 motion-reduce:transition-none sm:h-44 sm:w-40"
                  style={{
                    transform: isActive ? "translateY(-6px)" : "none",
                    boxShadow: isActive
                      ? "0 0 0 3px var(--sun), 0 16px 36px rgba(11,34,56,0.45)"
                      : "0 0 0 1px rgba(255,255,255,0.35), 0 8px 20px rgba(11,34,56,0.3)",
                  }}
                >
                  <img
                    src={`/media/${card.media.poster}/poster.webp`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="card-overlay absolute inset-0" aria-hidden="true" />

                  <div
                    className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                    style={{
                      background: "rgba(255,255,255,0.95)",
                      color: "var(--ink)",
                    }}
                  >
                    <span aria-hidden="true" style={{ color: "var(--sun-deep)" }}>
                      ★
                    </span>
                    {card.rating.toFixed(1)}
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: "rgba(255,255,255,0.85)" }}
                    >
                      {card.region}
                    </p>
                    <p className="font-display text-xl leading-tight text-white">{card.country}</p>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>

        <ScrollArrowButton
          dir="right"
          onClick={() => nudge(1, 260)}
          disabled={atEnd}
          label="Scroll destinations right"
        />
      </div>
    </div>
  );
}
