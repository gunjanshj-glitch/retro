"use client";

import { useEffect, useState } from "react";
import type { HeroCardRegion } from "@/content/schema";
import { defaultHeroCards, pickRandomHeroCards, type HeroCard } from "@/lib/hero-card-picker";
import { useHeroCarousel } from "@/lib/hero-carousel";
import { MediaLayer } from "./MediaLayer";
import { CardRail } from "./CardRail";
import { Button } from "@/components/ui/Button";

type Props = { heroCardRegions: HeroCardRegion[] };

export function AtlasScene({ heroCardRegions }: Props) {
  // Deterministic default (first card per region) so the server-rendered and
  // pre-hydration client markup match exactly; the effect below reshuffles to
  // a random country per region right after mount, so every fresh page load
  // (a real browser reload re-runs this client JS) shows a different pick.
  const [cards, setCards] = useState<HeroCard[]>(() => defaultHeroCards(heroCardRegions));

  useEffect(() => {
    // This is a deliberate one-time client-only randomization (not state
    // derived from props/state available during render), matching the same
    // default-then-correct pattern already used by usePrefersReducedMotion
    // (lib/reduced-motion.ts) for the same SSR/hydration-safety reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCards(pickRandomHeroCards(heroCardRegions));
    // Runs once per mount, deliberately not on every heroCardRegions
    // re-render — this data is static content, not something that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { activeIndex, inView, sectionRef, select, handleVideoEnded } = useHeroCarousel(cards.length);
  const active = cards[activeIndex];

  return (
    // h-screen: the hero stays a single viewport tall. The fixed white NavBar
    // (72px) sits over its top padding, and the media lives in an inset,
    // rounded photo card below it rather than bleeding under the bar.
    <section
      ref={sectionRef}
      className="relative h-screen min-h-[780px] w-full px-3 pb-3 pt-[80px] sm:px-5 md:px-8 md:pb-6 md:pt-[88px]"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="relative mx-auto flex h-full max-w-[1320px] flex-col justify-between gap-6 overflow-hidden rounded-[24px] md:rounded-[28px]"
        style={{
          background: active.palette.deep,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <MediaLayer cards={cards} activeIndex={activeIndex} inView={inView} onVideoEnded={handleVideoEnded} />

        {/* Navy legibility scrim: white copy on the left, white card rail below */}
        <div className="scrim-hero pointer-events-none absolute inset-0 z-[5]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[55%]"
          style={{
            background:
              "linear-gradient(to top, rgba(11,34,56,0.78) 0%, rgba(11,34,56,0.35) 55%, rgba(11,34,56,0) 100%)",
          }}
          aria-hidden="true"
        />

        {/* Hero copy */}
        <div
          // In normal flow (not absolute) so the copy and the card rail below
          // can never overlap, however short the window is.
          className="relative z-10 max-w-xl px-5 pt-7 sm:px-8 sm:pt-10 md:px-12 md:pt-14 lg:pt-16"
          data-testid="hero-panel"
        >
          <p
            className="mb-4 inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.16em]"
            style={{
              background: "rgba(255,255,255,0.95)",
              color: "var(--ink)",
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--sun-deep)" }}
              aria-hidden="true"
            />
            {active.region}
          </p>
          <h1
            className="font-display text-[2.4rem] leading-[1.02] text-white sm:text-5xl md:text-6xl"
            style={{ textShadow: "0 2px 24px rgba(11,34,56,0.35)" }}
          >
            {active.headline}
          </h1>
          <p
            className="mt-4 max-w-md text-base md:text-lg"
            style={{
              color: "rgba(255,255,255,0.92)",
              textShadow: "0 1px 12px rgba(11,34,56,0.4)",
            }}
          >
            {active.tagline}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 sm:gap-4">
            <Button href="/destinations">
              Explore Destinations
              <span aria-hidden="true">→</span>
            </Button>
            <Button href={`/destinations/${active.destinationSlug}/packages/${active.packageSlug}`} variant="ghost">
              {active.buttonLabel}
            </Button>
          </div>
        </div>

        {/* Bottom region: card rail */}
        <div className="relative z-30 px-3 pb-4 sm:px-5 md:px-10 md:pb-7">
          <CardRail cards={cards} activeIndex={activeIndex} onSelect={select} />
        </div>
      </div>
    </section>
  );
}
