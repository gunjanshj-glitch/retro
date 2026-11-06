import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDestination, loadDestinations } from "@/lib/destinations";
import { getPackagesForDestination } from "@/lib/packages";
import { getPackageImages } from "@/lib/package-images";
import { getPlaceInfo } from "@/lib/place-images";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { DestinationMapSection } from "@/components/destinations/DestinationMapSection";
import { PackagesRow } from "@/components/destinations/PackagesRow";
import { groupDisplayName, type RegionLayer, type RegionMarkers } from "@/lib/map-svg";

export function generateStaticParams() {
  return loadDestinations().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dest = loadDestination(slug);
  if (!dest) return {};
  return {
    title: `${dest.name} — Retro Holidays`,
    description: dest.tagline,
    openGraph: { images: [`/media/${dest.media.poster}/poster.webp`] },
  };
}

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dest = loadDestination(slug);
  if (!dest) notFound();

  const packages = getPackagesForDestination(dest).map((pkg) => ({
    ...pkg,
    coverImage: getPackageImages(dest.slug, pkg.packageSlug)[0],
  }));

  const mapMarkers = JSON.parse(getMapFileSync(dest.slug, "markers.json")) as RegionMarkers;
  // Count what the map shows: individual places, grouped into areas by name.
  const mapPlaces = mapMarkers.markers.filter((m) => m.level === 1);
  const placeCount = mapPlaces.length;
  const areaCount = new Set(mapPlaces.map((m) => groupDisplayName(m.country))).size;
  const regions = readRegions(dest.slug);
  // Photo, credit and blurb per place (server-side, only this destination's places).
  const placeInfo = Object.fromEntries(mapPlaces.map((m) => [m.name, getPlaceInfo(dest.slug, m.name)]));
  const packageCovers = Object.fromEntries(packages.map((p) => [p.id, p.coverImage]));

  return (
    <>
      <NavBar />

      <main className="pt-[72px]">
        {/* Hero: an inset photo card under the white bar */}
        <section className="mx-auto max-w-[1320px] px-5 pt-5 md:px-8">
          <div
            className="relative flex min-h-[420px] items-end overflow-hidden rounded-[28px] md:min-h-[min(58vh,560px)]"
            style={{ background: dest.palette.deep, boxShadow: "var(--shadow-lg)" }}
          >
            <img
              src={`/media/${dest.media.poster}/poster.webp`}
              alt=""
              className="hero-drift absolute inset-0 h-full w-full object-cover"
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "linear-gradient(180deg, rgba(11,34,56,0) 30%, rgba(11,34,56,0.75) 100%)" }}
              aria-hidden="true"
            />
            <div className="relative grid max-w-3xl gap-4 p-6 text-white sm:p-10 md:p-12">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/destinations"
                  className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition hover:-translate-y-px"
                  style={{ background: "#fff", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
                >
                  <span aria-hidden="true">←</span> All destinations
                </Link>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/90">{dest.region}</span>
              </div>
              <h1 className="font-display text-[44px] leading-[0.98] sm:text-6xl md:text-7xl">{dest.name}</h1>
              <p className="max-w-xl text-lg text-white/90 md:text-xl">{dest.tagline}</p>
              <ul className="mt-1 flex flex-wrap gap-2.5 text-sm font-semibold" style={{ color: "var(--ink)" }}>
                {[
                  `${areaCount} ${areaCount === 1 ? "area" : "areas"}`,
                  `${placeCount} places`,
                  `${packages.length} ${packages.length === 1 ? "package" : "packages"}`,
                ].map((t) => (
                  <li key={t} className="rounded-full bg-white/95 px-3.5 py-2 tabular-nums">
                    {t}
                  </li>
                ))}
                <li className="rounded-full bg-white/95 px-3.5 py-2 tabular-nums">
                  <span style={{ color: "var(--sun-deep)" }} aria-hidden="true">★</span> {dest.rating.toFixed(1)} rated
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Packages */}
        <section className="mx-auto max-w-[1320px] px-5 pt-14 md:px-8 md:pt-20" aria-labelledby="packages-heading">
          <div className="mb-7 max-w-2xl">
            <p className="eyebrow">Pick a trip, then make it yours</p>
            <h2 id="packages-heading" className="mt-2 font-display text-[34px] leading-[1.05] md:text-[46px]">
              Packages in {dest.region}
            </h2>
            <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
              {packages.length} hand-built {packages.length === 1 ? "package" : "packages"}. Each one is a starting point:
              change the dates, add a city or swap a hotel when you plan your trip.
            </p>
          </div>
          <PackagesRow destinationSlug={dest.slug} packages={packages} />
        </section>

        {/* The atlas: index panel + live map */}
        <section
          className="mt-4 pb-16 pt-10 md:mt-6 md:pb-20 md:pt-12"
          style={{ background: "linear-gradient(180deg, var(--bg) 0, var(--surface) 80px, var(--surface) 100%)" }}
          aria-labelledby="map-heading"
        >
          <div className="mx-auto max-w-[1320px] px-5 md:px-8">
            <div className="mb-7 max-w-2xl">
              <p className="eyebrow">Where we go</p>
              <h2 id="map-heading" className="mt-2 font-display text-[34px] leading-[1.05] md:text-[46px]">
                {placeCount} places, one map
              </h2>
              <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
                Some are well known; several are not. Pick an area to zoom in and see every place we visit, or choose a
                package to see its route.
              </p>
            </div>
            <DestinationMapSection
              destinationSlug={dest.slug}
              destinationName={dest.region}
              mapSvg={getMapFileSync(dest.slug, "svg")}
              mapMarkers={mapMarkers}
              regions={regions}
              groups={dest.groups ?? []}
              placeInfo={placeInfo}
              packageCovers={packageCovers}
            />
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

/** The per-country layer is optional: the map still works from the outline alone. */
function readRegions(slug: string): RegionLayer | null {
  try {
    return JSON.parse(getMapFileSync(slug, "regions.json")) as RegionLayer;
  } catch {
    return null;
  }
}

function getMapFileSync(slug: string, ext: "svg" | "markers.json" | "regions.json"): string {
  return readFileSync(path.join(process.cwd(), "public", "maps", `${slug}.${ext}`), "utf-8");
}

