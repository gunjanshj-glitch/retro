import type { Metadata } from "next";
import { fixSpelling } from "@/lib/display-names";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDestination, loadDestinations } from "@/lib/destinations";
import { getPackage, getPackagesForDestination } from "@/lib/packages";
import { getPackageImages } from "@/lib/package-images";
import { formatPrice } from "@/lib/trips";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { PackageRequestButton } from "@/components/packages/PackageRequestButton";

export function generateStaticParams() {
  return loadDestinations().flatMap((d) =>
    getPackagesForDestination(d).map((p) => ({
      slug: d.slug,
      packageSlug: p.packageSlug,
    })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; packageSlug: string }>;
}): Promise<Metadata> {
  const { slug, packageSlug } = await params;
  const dest = loadDestination(slug);
  const pkg = dest && getPackage(dest, packageSlug);
  if (!dest || !pkg) return {};
  return {
    title: `${pkg.packageName} — ${dest.name} — Retro Holidays`,
    description: fixSpelling(pkg.offer?.summary ?? pkg.tagline ?? ""),
    openGraph: { images: getPackageImages(dest.slug, pkg.packageSlug) },
  };
}

export default async function PackagePage({ params }: { params: Promise<{ slug: string; packageSlug: string }> }) {
  const { slug, packageSlug } = await params;
  const dest = loadDestination(slug);
  const pkg = dest && getPackage(dest, packageSlug);
  if (!dest || !pkg) notFound();

  const images = getPackageImages(dest.slug, pkg.packageSlug);
  const [heroImage, ...galleryImages] = images;
  const offer = pkg.offer;

  return (
    <>
      <NavBar />

      {/* Hero: inset rounded photo card under the fixed white nav */}
      <section className="px-3 pt-[80px] sm:px-5 md:px-8 md:pt-[92px]" style={{ background: "var(--bg)" }}>
        <div
          className="relative mx-auto flex min-h-[460px] max-w-[1320px] items-end overflow-hidden rounded-[24px] md:min-h-[540px] md:rounded-[28px]"
          style={{
            background: dest.palette.deep,
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <img src={heroImage} alt="" className="hero-drift absolute inset-0 h-full w-full object-cover" />
          <div className="scrim-hero pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative w-full max-w-3xl p-6 sm:p-8 md:p-12">
            <Link
              href={`/destinations/${dest.slug}`}
              className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-[filter] hover:brightness-95"
              style={{
                background: "rgba(255,255,255,0.95)",
                color: "var(--ink)",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
              Back to {dest.name}
            </Link>
            <p
              className="mb-3 text-xs font-bold uppercase tracking-[0.16em]"
              style={{ color: "rgba(255,255,255,0.9)" }}
            >
              {dest.region}
              {offer?.days ? ` · ${offer.days} days` : ""}
            </p>
            <h1
              className="font-display text-[2.6rem] leading-[1.0] text-white sm:text-6xl md:text-7xl"
              style={{ textShadow: "0 2px 24px rgba(11,34,56,0.35)" }}
            >
              {pkg.packageName}
            </h1>
            {pkg.tagline && (
              <p className="mt-4 max-w-xl text-lg" style={{ color: "rgba(255,255,255,0.92)" }}>
                {fixSpelling(pkg.tagline)}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-2.5">
              {offer?.price_from_usd ? (
                <span
                  className="rounded-full px-4 py-2 text-sm font-bold tabular-nums"
                  style={{ background: "var(--sun)", color: "var(--on-sun)" }}
                >
                  from {formatPrice(offer.price_from_usd)}
                </span>
              ) : null}
              <span
                className="rounded-full px-4 py-2 text-sm font-semibold tabular-nums"
                style={{
                  background: "rgba(255,255,255,0.95)",
                  color: "var(--ink)",
                }}
              >
                {pkg.places.length} {pkg.places.length === 1 ? "place" : "places"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 pt-14 md:px-8 md:pb-28 md:pt-20" style={{ background: "var(--bg)" }}>
        <div className="mx-auto grid max-w-[1320px] gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-16">
          <div className="min-w-0">
            <p className="eyebrow">The trip</p>
            <h2 className="mt-3 font-display text-3xl md:text-[2.6rem] md:leading-[1.05]">About this package</h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {fixSpelling(offer?.summary ?? pkg.tagline ?? "")}
            </p>

            {offer?.highlights && offer.highlights.length > 0 && (
              <>
                <h3 className="mt-12 font-display text-2xl" style={{ color: "var(--ink)" }}>
                  Package highlights
                </h3>
                <ul className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-2">
                  {offer.highlights.map((h) => (
                    <li
                      key={h}
                      className="flex gap-3 rounded-2xl border p-4 text-[15px] leading-relaxed"
                      style={{
                        background: "var(--surface)",
                        borderColor: "var(--line)",
                        color: "var(--ink-2)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: "var(--coral-soft)",
                          color: "var(--accent)",
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      </span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3 className="mt-12 font-display text-2xl" style={{ color: "var(--ink)" }}>
              Places covered
            </h3>
            <ul className="mt-5 flex max-w-3xl flex-wrap gap-2">
              {pkg.places.map((place) => (
                <li
                  key={place}
                  className="rounded-full px-3.5 py-1.5 text-sm font-semibold"
                  style={{ background: "var(--surface)", color: "var(--ink)" }}
                >
                  {fixSpelling(place)}
                </li>
              ))}
            </ul>

            {galleryImages.length > 0 && (
              <>
                <h3 className="mt-12 font-display text-2xl" style={{ color: "var(--ink)" }}>
                  Gallery
                </h3>
                <div className="mt-5 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
                  {galleryImages.map((src, i) => (
                    <div
                      key={src + i}
                      className="aspect-[4/3] overflow-hidden rounded-2xl"
                      style={{
                        background: "var(--surface)",
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Price + quote card */}
          <aside
            className="rounded-3xl border p-6 md:p-7 lg:sticky lg:top-[96px]"
            style={{
              background: "var(--card)",
              borderColor: "var(--line)",
              boxShadow: "var(--shadow)",
            }}
          >
            <p className="eyebrow">Price guide</p>
            <div className="mt-4 flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
                From
              </span>
              <span className="font-display text-4xl tabular-nums" style={{ color: "var(--ink)" }}>
                {formatPrice(offer?.price_from_usd ?? 0)}
              </span>
            </div>
            <p className="mt-1 text-right text-xs" style={{ color: "var(--ink-2)" }}>
              {offer?.price_includes_flight
                ? "per person, indicative, flights included"
                : "per person, indicative — land package only, flights extra"}
            </p>
            <div
              className="mt-5 flex items-baseline justify-between border-t pt-4"
              style={{ borderColor: "var(--line)" }}
            >
              <span className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
                Duration
              </span>
              <span className="font-semibold" style={{ color: "var(--ink)" }}>
                {offer?.days ? `${offer.days} days` : "Flexible"}
              </span>
            </div>
            <div className="mt-6">
              <PackageRequestButton
                pkg={{
                  destinationSlug: dest.slug,
                  destinationName: dest.name,
                  packageSlug: pkg.packageSlug,
                  packageName: pkg.packageName,
                  places: pkg.places,
                  days: offer?.days ?? null,
                  priceFromInr: offer?.price_from_usd ?? null,
                  includesFlight: !!offer?.price_includes_flight,
                }}
              />
            </div>
            <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
              Every trip is shaped by hand — this is a starting point, not a fixed package.
            </p>
          </aside>
        </div>
      </section>

      <Footer />
    </>
  );
}
