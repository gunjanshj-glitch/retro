import type { Metadata } from "next";
import { fixSpelling } from "@/lib/display-names";
import Link from "next/link";
import { loadDestinations } from "@/lib/destinations";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";

export const metadata: Metadata = {
  title: "Destinations — Retro Holidays",
  description: "Where to next? Every place we plan by hand.",
};

export default function DestinationsIndexPage() {
  const destinations = loadDestinations();

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-[1320px] px-5 pb-24 pt-[120px] md:px-8 md:pt-[136px]">
        <div className="max-w-2xl">
          <p className="eyebrow">Where to next</p>
          <h1 className="mt-2 font-display text-5xl leading-[1.02] md:text-6xl">Destinations</h1>
          <p className="mt-4 text-lg" style={{ color: "var(--muted)" }}>
            Where should your next trip go? We plan each of these by hand — pick a
            place to see the corners of it we know well.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((dest) => {
            // Cheapest package across every country/state group in this
            // region — shown as the card's headline price. Carried as the
            // whole offer, not just the number, so the card can say whether
            // airfare sits on top of it.
            const cheapest = (dest.groups ?? [])
              .map((g) => g.offer)
              .filter((o): o is NonNullable<typeof o> & { price_from_usd: number } =>
                typeof o?.price_from_usd === "number")
              .sort((a, b) => a.price_from_usd - b.price_from_usd)[0] ?? null;

            // Every place (city/POI) across the region's markers, deduped and
            // in first-seen order — not the country/state group names.
            const places = Array.from(new Set(dest.map.markers.map((m) => m.name)));
            const SHOWN_PLACES = 8;
            const shownPlaces = fixSpelling(places.slice(0, SHOWN_PLACES).join(", "));
            const extraPlaces = places.length - SHOWN_PLACES;

            return (
              <Link
                key={dest.slug}
                href={`/destinations/${dest.slug}`}
                className="lift group flex flex-col overflow-hidden rounded-[22px] border"
                style={{ background: "var(--card)", borderColor: "var(--line)" }}
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  <img
                    src={`/media/${dest.media.poster}/poster.webp`}
                    alt={dest.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div
                    className="absolute right-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
                    style={{ background: "rgba(255,255,255,0.95)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
                  >
                    <span aria-hidden="true" style={{ color: "var(--sun-deep)" }}>★</span>
                    {dest.rating.toFixed(1)}
                  </div>
                  {/* Hover overlay — transparent scrim with a centered Explore action */}
                  <div
                    className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: "rgba(11,34,56,0.35)" }}
                  >
                    <span
                      className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
                      style={{ background: "var(--sun)", color: "var(--on-sun)" }}
                    >
                      Explore
                      <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <h2 className="font-display text-[26px] leading-tight">{dest.region}</h2>
                  {places.length > 0 && (
                    <p className="line-clamp-2 text-sm leading-snug" style={{ color: "var(--muted)" }}>
                      {shownPlaces}
                      {extraPlaces > 0 && ` +${extraPlaces} more`}
                    </p>
                  )}
                  {cheapest && (
                    <p className="mt-auto pt-2 text-sm font-semibold tabular-nums">
                      From ₹{cheapest.price_from_usd.toLocaleString("en-IN")}
                      <span className="font-normal" style={{ color: "var(--muted)" }}>
                        {!cheapest.price_includes_flight && " + flights"}
                      </span>
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
