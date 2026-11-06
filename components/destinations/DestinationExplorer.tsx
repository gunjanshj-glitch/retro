"use client";

/**
 * The destination atlas: an index panel beside a live region map.
 *
 * Everything the map can do is also reachable from the panel (pick a country
 * or state, pick a package, pick a place), so it works without hover — on
 * phones and from the keyboard — and the map never has to trap the page's
 * scroll to be useful.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PlaceInfo } from "@/lib/place-images";
import { displayName } from "@/lib/display-names";
import { RegionMap } from "@/components/map/RegionMap";
import { groupDisplayName, markerKey, type MapMarker, type RegionLayer, type RegionMarkers } from "@/lib/map-svg";
import type { Group } from "@/content/schema";
import { useHorizontalScroll } from "@/lib/use-horizontal-scroll";
import { ScrollArrowButton } from "@/components/ui/ScrollArrowButton";

type Props = {
  destinationSlug: string;
  destinationName: string;
  mapSvg: string;
  markers: RegionMarkers;
  regions?: RegionLayer | null;
  groups?: Group[];
  /** Photo, credit and blurb per place name, prepared on the server. */
  placeInfo?: Record<string, PlaceInfo>;
  /** Cover image per package id; the fallback photo for a place without its own. */
  packageCovers?: Record<number, string>;
};

/** One row of the index: a country/state, possibly several map groupings merged by name. */
type Entry = { label: string; keys: Set<string>; count: number; places: MapMarker[] };

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function DestinationExplorer({
  destinationSlug,
  destinationName,
  mapSvg,
  markers,
  regions,
  groups = [],
  placeInfo = {},
  packageCovers = {},
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [active, setActive] = useState<MapMarker | null>(null);

  const entries = useMemo<Entry[]>(() => {
    const byLabel = new Map<string, Entry>();
    for (const m of markers.markers) {
      if (m.level !== 1) continue;
      const label = groupDisplayName(m.country);
      const e = byLabel.get(label) ?? { label, keys: new Set<string>(), count: 0, places: [] };
      e.keys.add(m.country);
      e.count += 1;
      e.places.push(m);
      byLabel.set(label, e);
    }
    for (const e of byLabel.values()) e.places.sort((a, b) => a.rank - b.rank);
    return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [markers.markers]);

  const entryOf = (group: string | null) => (group ? entries.find((e) => e.keys.has(group)) ?? null : null);
  const selectedEntry = entries.find((e) => e.label === selected) ?? null;
  const hotEntry = entries.find((e) => e.label === hot) ?? null;
  const pkg = groups.find((g) => g.id === packageId) ?? null;
  const pkgPlaces = useMemo(
    () => (packageId == null ? [] : markers.markers.filter((m) => m.level === 1 && m.group === packageId)),
    [markers.markers, packageId],
  );
  const pkgLabels = useMemo(() => new Set(pkgPlaces.map((m) => groupDisplayName(m.country))), [pkgPlaces]);
  const selectedHasSeveralPackages = !!selectedEntry && new Set(selectedEntry.places.map((m) => m.group)).size > 1;
  const totalPlaces = entries.reduce((n, e) => n + e.count, 0);
  const packagesWithPlaces = groups.filter((g) => markers.markers.some((m) => m.group === g.id));

  const openEntry = (label: string) => {
    setSelected(label);
    setPackageId(null);
    setActive(null);
    setHot(null);
  };
  const togglePackage = (id: number) => {
    setPackageId((p) => (p === id ? null : id));
    setSelected(null);
    setActive(null);
  };
  const back = () => {
    setSelected(null);
    setPackageId(null);
    setActive(null);
  };

  useEffect(() => {
    if (!selected && packageId == null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, packageId]);

  const title = selectedEntry?.label ?? pkg?.packageName ?? destinationName;
  const subtitle = selectedEntry
    ? `${selectedEntry.count} ${selectedEntry.count === 1 ? "place" : "places"} we visit`
    : pkg
      ? `${pkgLabels.size} ${pkgLabels.size === 1 ? "stop" : "stops"} · ${pkgPlaces.length} places`
      : `${entries.length} ${entries.length === 1 ? "area" : "areas"} · ${totalPlaces} places`;

  return (
    <div className="grid gap-6">
      {packagesWithPlaces.length > 0 && (
        <PackageRail packages={packagesWithPlaces} covers={packageCovers} activeId={packageId} onToggle={togglePackage} />
      )}
    <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-7">
      {/* Map */}
      <div className="min-w-0 lg:order-2">
        <div
          className="relative overflow-hidden rounded-[28px]"
          style={{ height: "clamp(380px, 70vh, 720px)", boxShadow: "var(--shadow)", background: "var(--card)" }}
        >
          <RegionMap
            svg={mapSvg}
            markers={markers}
            regions={regions}
            mapKey={destinationSlug}
            ariaLabel={`Map of ${destinationName}`}
            selectedGroups={selectedEntry?.keys ?? null}
            packageId={packageId}
            hotGroups={hotEntry?.keys ?? null}
            activePlace={active}
            onGroupHover={(g) => setHot(entryOf(g)?.label ?? null)}
            onGroupSelect={(g) => {
              const e = entryOf(g);
              if (e) openEntry(e.label);
            }}
            onPlaceHover={(m) => m && setActive(m)}
            onPlaceSelect={(m) => setActive(m)}
          />
        </div>
        <p className="mt-3 hidden flex-wrap gap-x-5 gap-y-1 text-sm sm:flex" style={{ color: "var(--muted)" }}>
          <span>The page scrolls normally over the map</span>
          <span>
            <Kbd>Ctrl</Kbd> or <Kbd>⌘</Kbd> + scroll to zoom
          </span>
          <span>Drag to move when zoomed</span>
          <span>Pinch with two fingers on a phone</span>
        </p>
      </div>

      {/* Index panel */}
      <aside
        className="grid min-w-0 gap-5 rounded-[28px] p-5 sm:p-6 lg:order-1"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
        aria-label={`${destinationName} map index`}
      >
        <div className="flex min-h-11 items-center gap-3">
          {(selectedEntry || pkg) && (
            <button
              type="button"
              onClick={back}
              aria-label={`Back to all of ${destinationName}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--line)]"
              style={{ background: "var(--surface)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h3 className="font-display text-[28px] leading-tight">{title}</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {subtitle}
            </p>
          </div>
        </div>

        <ul className="-mx-2 grid max-h-[420px] gap-0.5 overflow-auto px-2" style={{ scrollbarWidth: "thin" }}>
          {selectedEntry
            ? selectedEntry.places.map((m) => {
                const on = active && markerKey(active) === markerKey(m);
                const g = groups.find((x) => x.id === m.group);
                return (
                  <li key={markerKey(m)}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(m)}
                      onFocus={() => setActive(m)}
                      onClick={() => setActive(m)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left font-semibold transition-colors hover:bg-[var(--surface)]"
                      style={{ background: on ? "var(--surface)" : undefined, color: on ? "var(--ink)" : "var(--muted)" }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--muted)", boxShadow: "0 0 0 3px var(--surface)" }} />
                      <span className="min-w-0 flex-1 truncate">{displayName(m.name)}</span>
                      {g && selectedHasSeveralPackages && (
                        <span className="max-w-[45%] truncate rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--muted)" }}>
                          {g.packageName}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            : entries.map((e) => {
                const dim = packageId != null && !pkgLabels.has(e.label);
                const isHot = hot === e.label;
                return (
                  <li key={e.label}>
                    <button
                      type="button"
                      onMouseEnter={() => setHot(e.label)}
                      onMouseLeave={() => setHot(null)}
                      onFocus={() => setHot(e.label)}
                      onBlur={() => setHot(null)}
                      onClick={() => openEntry(e.label)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left font-semibold transition-colors hover:bg-[var(--surface)]"
                      style={{
                        background: isHot ? "var(--surface)" : undefined,
                        color: isHot ? "var(--ink)" : "var(--muted)",
                        opacity: dim ? 0.4 : 1,
                      }}
                    >
                      <span className="h-3 w-3 shrink-0 rounded" style={{ background: isHot ? "var(--sun-deep)" : "var(--sun)" }} />
                      <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
                        style={{ background: isHot ? "var(--card)" : "var(--surface)", color: "var(--muted)" }}
                      >
                        {e.count}
                      </span>
                    </button>
                  </li>
                );
              })}
        </ul>

        <DetailCard
          destinationSlug={destinationSlug}
          place={active}
          pkg={pkg}
          groups={groups}
          hasSelection={!!selectedEntry}
          info={active ? placeInfo[active.name] : undefined}
          packageCovers={packageCovers}
        />
      </aside>
    </div>
    </div>
  );
}

function DetailCard({
  destinationSlug,
  place,
  pkg,
  groups,
  hasSelection,
  info,
  packageCovers,
}: {
  destinationSlug: string;
  place: MapMarker | null;
  pkg: Group | null;
  groups: Group[];
  hasSelection: boolean;
  info?: PlaceInfo;
  packageCovers: Record<number, string>;
}) {
  const group = place?.group != null ? groups.find((g) => g.id === place.group) : pkg;
  if (!place && !pkg) {
    return (
      <p className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--surface)", color: "var(--muted)" }}>
        {hasSelection ? "Pick a place to see which package visits it." : "Pick an area to zoom in, or a package to see its route."}
      </p>
    );
  }
  const offer = group?.offer;
  const ownPhoto = place ? info?.image : undefined;
  const image = ownPhoto ?? (group ? packageCovers[group.id] : undefined);
  const description = (place ? info?.description : undefined) ?? group?.tagline;
  return (
    <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--line)" }} aria-live="polite">
      {image && (
        <figure className="relative">
          <img src={image} alt={place?.name ?? group?.packageName ?? ""} className="block aspect-[16/9] w-full object-cover" loading="lazy" />
          {ownPhoto && info?.illustration && (
            <figcaption
              className="absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm"
              style={{ background: "var(--card)", color: "var(--text)" }}
              title="This picture is an illustration, not a photograph of the place."
            >
              Illustration
            </figcaption>
          )}
          {ownPhoto && info?.credit && (
            <figcaption className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-3 pb-1.5 pt-4 text-[10.5px] text-white/90">
              {info.creditUrl ? (
                <a href={info.creditUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {info.credit}
                </a>
              ) : (
                info.credit
              )}
            </figcaption>
          )}
        </figure>
      )}
      <div className="grid gap-1.5 p-4">
        <p className="eyebrow">{place ? `${displayName(place.name)} · ${groupDisplayName(place.country)}` : "Package"}</p>
        <p className="font-display text-[22px] leading-tight">{group ? group.packageName : place ? displayName(place.name) : ""}</p>
        {description && (
          <p className="line-clamp-3 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            {description}
          </p>
        )}
        {offer && (offer.days || offer.price_from_usd) && (
          <p className="text-sm font-semibold tabular-nums">
            {offer.days ? `${offer.days} days` : ""}
            {offer.days && offer.price_from_usd ? " · " : ""}
            {offer.price_from_usd ? `from ${inr(offer.price_from_usd)}` : ""}
            {offer.price_from_usd && !offer.price_includes_flight ? " + flights" : ""}
          </p>
        )}
        {group ? (
          <Link
            href={`/destinations/${destinationSlug}/packages/${group.packageSlug}`}
            className="mt-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold"
            style={{ background: "var(--sun)", color: "var(--on-sun)" }}
          >
            View package <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Link
            href="/plan"
            className="mt-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-bold"
            style={{ borderColor: "var(--line-strong)" }}
          >
            Plan a trip with this place <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-b-2 px-1.5 py-px text-xs font-bold" style={{ borderColor: "var(--line)", background: "var(--card)", fontFamily: "inherit" }}>
      {children}
    </kbd>
  );
}

/** "Show a package": one horizontal, swipeable row of small cards (India has three dozen packages). */
function PackageRail({
  packages,
  covers,
  activeId,
  onToggle,
}: {
  packages: Group[];
  covers: Record<number, string>;
  activeId: number | null;
  onToggle: (id: number) => void;
}) {
  const { scrollerRef, atStart, atEnd, nudge } = useHorizontalScroll<HTMLDivElement>();
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
          See a package&apos;s route on the map
        </p>
        {packages.length > 2 && (
          <div className="flex gap-1.5">
            <ScrollArrowButton dir="left" onClick={() => nudge(-1, 440)} disabled={atStart} label="Scroll packages left" />
            <ScrollArrowButton dir="right" onClick={() => nudge(1, 440)} disabled={atEnd} label="Scroll packages right" />
          </div>
        )}
      </div>
      <div
        ref={scrollerRef}
        className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto scroll-smooth px-1 pb-1"
        role="group"
        aria-label="Show a package on the map"
      >
        {packages.map((g) => {
          const on = g.id === activeId;
          const img = covers[g.id];
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(g.id)}
              className="group w-[190px] shrink-0 sm:w-[210px] overflow-hidden rounded-2xl border text-left transition-shadow hover:shadow-md"
              style={{ borderColor: on ? "var(--ink)" : "var(--line)", background: "var(--card)", boxShadow: on ? "0 0 0 2px var(--ink)" : undefined }}
            >
              <span className="relative block aspect-[4/3] overflow-hidden" style={{ background: "var(--surface)" }}>
                {img && <img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />}
                {on && (
                  <span className="absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--ink)", color: "#fff" }}>
                    On map
                  </span>
                )}
              </span>
              <span className="block p-2.5">
                <span className="line-clamp-2 block text-sm font-bold leading-snug">{g.packageName}</span>
                {g.offer?.days && (
                  <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                    {g.offer.days} days
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
