import { loadHeroCardRegions } from "@/lib/hero-cards";
import { fetchGoogleReviews } from "@/lib/google-reviews";
import { AtlasScene } from "@/components/atlas/AtlasScene";
import { FeatureRow } from "@/components/atlas/FeatureRow";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { Button } from "@/components/ui/Button";
import { ReviewText } from "@/components/ui/ReviewText";
import { PackagesRow, type PackageCardData } from "@/components/destinations/PackagesRow";
import { loadDestinations } from "@/lib/destinations";
import { getPackagesForDestination } from "@/lib/packages";
import { getPackageImages } from "@/lib/package-images";

const REVIEWS = [
  {
    name: "Sarah Mitchell",
    date: "October 2024",
    stars: 5,
    text: "We did Kashmir in October. My husband had planned dozens of trips himself before — this was the first time he didn't need to. Every detail was handled, and the guide knew places we'd never have found on our own. Still talking about the night in Sonamarg.",
    initial: "S",
  },
  {
    name: "James Okafor",
    date: "August 2024",
    stars: 5,
    text: "I usually plan everything myself. They sent me exactly what I asked for, no filler, no padding. And when our flight got delayed, they sorted it before I'd even messaged them. 5 stars feels like an understatement.",
    initial: "J",
  },
  {
    name: "Elena Vasquez",
    date: "March 2025",
    stars: 5,
    text: "Nordic trip, six countries, three weeks. It should have been a logistical nightmare. The routing made sense in a way I couldn't have figured out on my own. The Aurora viewing in Tromsø was timed perfectly — absolute silence, full sky.",
    initial: "E",
  },
  {
    name: "David Chen",
    date: "November 2024",
    stars: 5,
    text: "We brought eight people to Peru — three generations of family, completely different interests. What they put together worked for all of us. That felt like a minor miracle. The Machu Picchu timing was especially thoughtful: we had the whole place to ourselves at dawn.",
    initial: "D",
  },
];

/** One priced package per destination, then second picks, up to `limit`. */
function featuredPackages(limit = 8): PackageCardData[] {
  const perDest = loadDestinations().map((d) =>
    getPackagesForDestination(d)
      .filter((p) => p.offer?.price_from_usd)
      .map((p) => ({
        ...p,
        coverImage: getPackageImages(d.slug, p.packageSlug)[0],
        destinationSlug: d.slug,
        destinationName: d.name,
      }))
      .filter((p) => p.coverImage),
  );
  const out: PackageCardData[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const list of perDest) {
      if (list[round] && out.length < limit) {
        out.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export default async function HomePage() {
  const heroCardRegions = loadHeroCardRegions();
  const featured = featuredPackages();
  const live = await fetchGoogleReviews();
  const reviews = (live && live.reviews.length ? live.reviews : REVIEWS).slice(0, 4);
  const rating = live ? live.rating.toFixed(1) : "4.9";
  const total = live ? live.total : 77;

  return (
    <>
      <NavBar />
      <AtlasScene heroCardRegions={heroCardRegions} />

      {/* Trust bar — the guarantees that make booking easy */}
      <section className="px-5 pt-6 md:px-8 md:pt-8" style={{ background: "var(--bg)" }}>
        <div
          className="mx-auto max-w-[1320px] rounded-3xl border px-6 py-8 md:px-10 md:py-10"
          style={{ background: "var(--surface)", borderColor: "var(--line)" }}
        >
          <FeatureRow />
        </div>
      </section>

      {/* Popular packages — real packages with prices, so browsers have something to open */}
      {featured.length > 0 && (
        <section className="px-5 pt-16 md:px-8 md:pt-24" style={{ background: "var(--bg)" }}>
          <div className="mx-auto max-w-[1320px]">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Start with a proven trip</p>
                <h2 className="mt-3 font-display text-3xl md:text-[2.75rem] md:leading-[1.05]">Popular packages</h2>
                <p className="mt-3 max-w-xl text-base" style={{ color: "var(--ink-2)" }}>
                  Hand-built itineraries with a starting price. Open one, then change the dates or swap a hotel.
                </p>
              </div>
              <Button href="/destinations" variant="ghost">
                All destinations
                <span aria-hidden="true">→</span>
              </Button>
            </div>
            <PackagesRow destinationSlug="" packages={featured} deferImages />
          </div>
        </section>
      )}

      {/* "You will not remember the itinerary" section */}
      <section className="px-5 py-20 md:px-8 md:py-28" style={{ background: "var(--bg)" }}>
        <div className="mx-auto grid max-w-[1320px] items-center gap-10 md:grid-cols-[1.3fr_1fr] md:gap-16">
          <div>
            <p className="eyebrow">Why travel with us</p>
            <h2 className="mt-3 max-w-3xl font-display text-4xl leading-[1.05] md:text-6xl">
              You will not remember the itinerary.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>
              Twelve years of trips people still talk about. {rating} stars, {total} reviews, two founders who still
              answer the phone.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
              <Button href="/plan">
                Plan your trip
                <span aria-hidden="true">→</span>
              </Button>
              <Button href="/contact" variant="ghost">
                Get in touch
              </Button>
            </div>
          </div>
          <dl
            className="grid grid-cols-3 gap-4 rounded-3xl border p-6 text-center md:grid-cols-1 md:gap-6 md:p-8 md:text-left"
            style={{ background: "var(--surface)", borderColor: "var(--line)" }}
          >
            {[
              { k: `${rating}★`, v: "Google rating" },
              { k: `${total}`, v: "Google reviews" },
              { k: "12 yrs", v: "Planning trips" },
            ].map((x) => (
              <div key={x.v}>
                <dt className="font-display text-3xl tabular-nums md:text-5xl">{x.k}</dt>
                <dd className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
                  {x.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Google Reviews section */}
      <section className="px-5 py-20 md:px-8 md:py-24" style={{ background: "var(--surface)" }}>
        <div className="mx-auto max-w-[1320px]">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">What people say</p>
              <h2 className="mt-3 font-display text-3xl md:text-[2.75rem] md:leading-[1.05]">Reviews from Google</h2>
            </div>
            <p
              className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tabular-nums"
              style={{
                background: "var(--card)",
                borderColor: "var(--line)",
                color: "var(--ink)",
              }}
            >
              <span className="text-base" style={{ color: "var(--accent)" }} aria-hidden="true">
                ★★★★★
              </span>
              {rating} · {total} reviews
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {reviews.map((r) => (
              <div
                key={r.name}
                className="lift flex flex-col gap-4 rounded-2xl border p-6"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--line)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold"
                    style={{
                      background: "var(--coral-soft)",
                      color: "var(--accent)",
                    }}
                  >
                    {r.initial}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {r.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {r.date}
                    </p>
                  </div>
                </div>

                <p className="text-sm leading-[1.65]" style={{ color: "var(--ink-2)" }}>
                  {r.stars === 5 && (
                    <span
                      className="mb-1.5 block text-sm tracking-wider"
                      style={{ color: "var(--accent)" }}
                      role="img"
                      aria-label="5 stars"
                    >
                      ★★★★★
                    </span>
                  )}
                  <ReviewText text={r.text} />
                </p>

                <div className="mt-auto flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                    Posted on Google
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
