"use client";

import { fixSpelling } from "@/lib/display-names";
import Link from "next/link";
import type { Group } from "@/content/schema";
import { useHorizontalScroll } from "@/lib/use-horizontal-scroll";
import { ScrollArrowButton } from "@/components/ui/ScrollArrowButton";
import { formatPrice } from "@/lib/trips";

export type PackageCardData = Group & { coverImage: string };

type Props = {
  destinationSlug: string;
  packages: PackageCardData[];
};

// No scroll-snap on this row, on purpose. A snapping row performs a compositor
// scroll on first layout, which Chrome counts as a scroll and stops recording
// Largest Contentful Paint. The page then reports no LCP at all (Lighthouse:
// NO_LCP, performance score NaN) and the CI gate fails at random.
// Horizontally scrolling row of package cards, with always-visible prev/next
// arrows — not just touch/trackpad swipe — so the row is scrollable on every
// screen size, including mouse-only desktops at a narrower viewport.
export function PackagesRow({ destinationSlug, packages }: Props) {
  const { scrollerRef, atStart, atEnd, nudge } = useHorizontalScroll<HTMLDivElement>();

  return (
    <div>
      <div
        ref={scrollerRef}
        className="no-scrollbar -mx-1 flex gap-5 overflow-x-auto px-1 pb-4 pt-1"
        role="list"
      >
        {packages.map((pkg) => (
          <div key={pkg.id} role="listitem" className="contents">
            <Link
              href={`/destinations/${destinationSlug}/packages/${pkg.packageSlug}`}
              className="lift group flex w-[78vw] max-w-[300px] shrink-0 flex-col overflow-hidden rounded-[20px] border sm:w-[280px]"
              style={{ background: "var(--card)", borderColor: "var(--line)" }}
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={pkg.coverImage}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                {pkg.offer?.price_from_usd && (
                  <div
                    className="absolute bottom-3 left-3 rounded-full px-3 py-1.5 text-sm font-extrabold tabular-nums"
                    style={{ background: "var(--sun)", color: "var(--on-sun)", boxShadow: "var(--shadow-sm)" }}
                  >
                    from {formatPrice(pkg.offer.price_from_usd)}
                    {!pkg.offer.price_includes_flight && <span className="font-semibold opacity-75"> + flights</span>}
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-4 pb-5">
                <h3 className="font-display text-[22px] leading-tight">{pkg.packageName}</h3>
                {pkg.tagline && (
                  <p className="line-clamp-2 text-sm leading-snug" style={{ color: "var(--muted)" }}>
                    {fixSpelling(pkg.tagline)}
                  </p>
                )}
                <p className="mt-auto pt-2 text-sm font-semibold" style={{ color: "var(--muted)" }}>
                  {pkg.places.length} {pkg.places.length === 1 ? "place" : "places"} ·{" "}
                  {pkg.offer?.days ? `${pkg.offer.days} days` : "Flexible"}
                </p>
              </div>
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <ScrollArrowButton dir="left" onClick={() => nudge(-1)} disabled={atStart} label="Scroll packages left" />
        <ScrollArrowButton dir="right" onClick={() => nudge(1)} disabled={atEnd} label="Scroll packages right" />
      </div>
    </div>
  );
}
