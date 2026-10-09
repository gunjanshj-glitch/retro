"use client";

/**
 * World map picker for "I know where I want to go".
 *
 * Shows one world map with the ten catalogue regions as hoverable, clickable
 * shapes (`public/maps/world.json`, built by `scripts/build-maps/world.ts`).
 * Clicking a region crossfades/zooms into that region's own detailed map —
 * the same per-region SVG + marker files the destinations pages already use —
 * where individual places become selectable pins.
 */
import { useEffect, useMemo, useState } from "react";
import type { CoreBundle } from "@/lib/atlas/schema";
import { evaluatePlaceSelectability, type PlaceSelectability } from "@/lib/atlas/engine/bounds";
import { useZoomPan, ZOOM_MAX, ZOOM_MIN } from "@/lib/use-zoom-pan";
import { pinMetrics, placePinLabels, selectVisiblePins, type DeclutterPin } from "@/lib/map-declutter";
import { countryBox, markerKey, type MapMarker, type RegionMarkers } from "@/lib/map-svg";

type WorldRegion = {
  id: string;
  name: string;
  path: string;
  bbox: [number, number, number, number];
  labelX: number;
  labelY: number;
};

type WorldMap = {
  viewBox: [number, number, number, number];
  /** Every country on Earth (bar Antarctica), merged into one inert
   *  backdrop path so unsupported places still "stay as it is" — visible,
   *  never interactive — instead of empty space. */
  land: string;
  regions: WorldRegion[];
};

/** Catalogue region id -> the per-region map asset built for it. */
const REGION_ASSET: Record<string, string> = {
  africa: "africa",
  "eurasia-cis": "eurasia-cis",
  russia: "russia",
  "south-asia": "south-asia",
  "east-asia": "east-asia",
  europe: "europe",
  "middle-east-and-gulf": "middle-east",
  oceania: "oceania",
  "south-east-asia": "south-east-asia",
  india: "india",
};

/** How far the world layer "pushes in" while the region layer fades over it. */
const ZOOM_SCALE = 5;
const TRANSITION_MS = 380;

/** Pin geometry: a rounded teardrop, tip at the origin, bulb centred above it. */
const PIN_PATH =
  "M0,0 C-6,-7 -9,-12.5 -9,-18 A9,9 0 1 1 9,-18 C9,-12.5 6,-7 0,0 Z";
const PIN_SCALE = 0.85;


type Props = {
  core: CoreBundle;
  selected: string[];
  /**
   * Accepts an updater as well as a plain array, so a rapid burst of clicks
   * can never compute from a stale selection — React batches the state
   * updates, and a plain array would make every click in the batch overwrite
   * the previous one instead of adding to it.
   */
  onChange: (placeIds: string[] | ((current: string[]) => string[])) => void;
};

export function WorldMapPicker({ core, selected, onChange }: Props) {
  const [world, setWorld] = useState<WorldMap | null>(null);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [hoveredPlace, setHoveredPlace] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // A one-shot client capability check — window/matchMedia only exist after
    // mount, and this value doesn't feed any other effect, so it can't cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    fetch("/maps/world.json")
      .then((r) => r.json())
      .then(setWorld)
      .catch(() => setWorld(null));
  }, []);

  const activeRegion = world?.regions.find((r) => r.id === regionId) ?? null;
  const duration = reduceMotion ? 0 : TRANSITION_MS;

  // Transform-origin for the world layer's "push through" zoom, expressed as
  // percentages of its own viewBox so it lines up with the clicked region.
  const zoomOrigin = activeRegion
    ? {
        x: ((activeRegion.bbox[0] + activeRegion.bbox[2] / 2) / (world?.viewBox[2] ?? 1)) * 100,
        y: ((activeRegion.bbox[1] + activeRegion.bbox[3] / 2) / (world?.viewBox[3] ?? 1)) * 100,
      }
    : { x: 50, y: 50 };

  const placeByName = useMemo(() => {
    const m = new Map<string, CoreBundle["places"][number]>();
    for (const p of core.places) m.set(p.name.toLowerCase(), p);
    return m;
  }, [core.places]);

  const countryName = useMemo(
    () => new Map(core.countries.map((c) => [c.id, c.name])),
    [core.countries],
  );

  const selectedSet = new Set(selected);
  const selectability = useMemo(() => evaluatePlaceSelectability(core, selected), [core, selected]);
  const placesByRegion = useMemo(() => {
    const countryToRegion = new Map(core.countries.map((c) => [c.id, c.regionId]));
    const m = new Map<string, string[]>();
    for (const p of core.places) {
      const regionId = countryToRegion.get(p.countryId);
      if (!regionId) continue;
      const list = m.get(regionId);
      if (list) list.push(p.id);
      else m.set(regionId, [p.id]);
    }
    return m;
  }, [core.places, core.countries]);
  const toggle = (placeId: string) => {
    onChange((current) =>
      current.includes(placeId) ? current.filter((id) => id !== placeId) : [...current, placeId],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {regionId
          ? "Click a pin to add it to your trip — click again to remove it. Zoom in to separate places that sit close together, and drag to move around. Greyed-out pins aren't realistically combinable with what you've already picked."
          : "Hover a region to preview it, then click to zoom in and pick your places. Once you've picked somewhere, regions and places that don't sensibly combine with it grey out."}
      </p>

      <div
        className="relative overflow-hidden rounded-2xl border"
        style={{
          borderColor: "var(--hairline)",
          background: "color-mix(in srgb, var(--accent) 4%, transparent)",
          aspectRatio: world ? `${world.viewBox[2]} / ${world.viewBox[3]}` : "960 / 500",
        }}
      >
        {!world && (
          <p className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
            Loading map…
          </p>
        )}

        {world && (
          <>
            {/* World layer: always mounted, pushed through and faded out while a region is open. */}
            <div
              className="absolute inset-0"
              style={{
                opacity: regionId ? 0 : 1,
                transform: regionId ? `scale(${ZOOM_SCALE})` : "scale(1)",
                transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                transition: `opacity ${duration}ms ease, transform ${duration}ms ease`,
                pointerEvents: regionId ? "none" : "auto",
              }}
            >
              <svg viewBox={world.viewBox.join(" ")} className="h-full w-full" role="group" aria-label="World regions">
                {/* Inert backdrop: every country on Earth, so the picker reads as an
                    ordinary atlas instead of ten shapes floating in empty space.
                    Unsupported countries "stay as it is" — visible, never interactive. */}
                <path
                  d={world.land}
                  fill="var(--surface)"
                  stroke="var(--hairline)"
                  strokeWidth={0.6}
                  pointerEvents="none"
                />
                {world.regions.map((r) => {
                  const isHovered = hoveredRegion === r.id;
                  const regionPlaces = placesByRegion.get(r.id) ?? [];
                  const regionEntries = regionPlaces.map((id) => selectability.get(id));
                  const isDisabled = !regionEntries.some((e) => e?.allowed);
                  const disabledReason = regionEntries.find((e) => e && !e.allowed)?.reason
                    ?? "Not realistically combinable with your current selection";
                  return (
                    <g
                      key={r.id}
                      role="button"
                      tabIndex={isDisabled ? -1 : 0}
                      aria-disabled={isDisabled}
                      aria-label={isDisabled ? `${r.name} — ${disabledReason}` : `Explore ${r.name}`}
                      className={isDisabled ? "cursor-not-allowed" : "cursor-pointer"}
                      style={{ outline: "none" }}
                      onMouseEnter={() => !isDisabled && setHoveredRegion(r.id)}
                      onMouseLeave={() => setHoveredRegion((c) => (c === r.id ? null : c))}
                      onFocus={() => !isDisabled && setHoveredRegion(r.id)}
                      onBlur={() => setHoveredRegion((c) => (c === r.id ? null : c))}
                      onClick={() => !isDisabled && setRegionId(r.id)}
                      onKeyDown={(e) => {
                        if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          setRegionId(r.id);
                        }
                      }}
                    >
                      <title>{isDisabled ? disabledReason : r.name}</title>
                      <path
                        d={r.path}
                        fill={isDisabled ? "var(--surface)" : isHovered ? "var(--accent)" : "var(--muted)"}
                        fillOpacity={isDisabled ? 0.35 : isHovered ? 0.35 : 0.16}
                        stroke={isDisabled ? "var(--hairline)" : isHovered ? "var(--accent)" : "var(--hairline)"}
                        strokeWidth={isHovered && !isDisabled ? 1.5 : 1}
                        style={{ transition: "fill-opacity 0.15s ease, stroke 0.15s ease" }}
                      />
                      {isHovered && !isDisabled && (
                        <text
                          x={r.labelX}
                          y={r.labelY}
                          textAnchor="middle"
                          fontSize={13}
                          fontWeight={700}
                          fill="var(--text)"
                          stroke="var(--deep)"
                          strokeWidth={3}
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {r.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Region layer: fades/scales in over the world layer once a region is picked. */}
            <div
              className="absolute inset-0"
              style={{
                opacity: regionId ? 1 : 0,
                transform: regionId ? "scale(1)" : "scale(0.92)",
                transition: `opacity ${duration}ms ease, transform ${duration}ms ease`,
                pointerEvents: regionId ? "auto" : "none",
              }}
            >
              {regionId && (
                <RegionView
                  regionId={regionId}
                  placeByName={placeByName}
                  selectedSet={selectedSet}
                  selectability={selectability}
                  countryName={countryName}
                  hoveredPlace={hoveredPlace}
                  onHoverPlace={setHoveredPlace}
                  onToggle={toggle}
                  onBack={() => setRegionId(null)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zoomed-in region view
// ---------------------------------------------------------------------------

type RegionViewProps = {
  regionId: string;
  placeByName: Map<string, CoreBundle["places"][number]>;
  selectedSet: Set<string>;
  /** Selectability (allowed + reason) for every place in the catalogue,
   *  given the current selection. */
  selectability: Map<string, PlaceSelectability>;
  /** Country id -> display name, for labelling island nations the map is too
   *  coarse to draw. */
  countryName: Map<string, string>;
  hoveredPlace: string | null;
  onHoverPlace: (id: string | null) => void;
  onToggle: (placeId: string) => void;
  onBack: () => void;
};

function RegionView({
  regionId, placeByName, selectedSet, selectability, countryName, hoveredPlace, onHoverPlace, onToggle, onBack,
}: RegionViewProps) {
  const asset = REGION_ASSET[regionId];
  // Held together so a stale response from the previous region can never be
  // rendered under the new region's key, and "loading" is derived rather than
  // tracked as a separate flag that could fall out of sync.
  const [loaded, setLoaded] = useState<{ asset: string; svg: string; markers: RegionMarkers } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/maps/${asset}.svg`).then((r) => r.text()),
      fetch(`/maps/${asset}.markers.json`).then((r) => r.json() as Promise<RegionMarkers>),
    ])
      .then(([svg, markers]) => {
        if (!cancelled) setLoaded({ asset, svg, markers });
      })
      .catch(() => {
        /* leave loaded as-is; the loading placeholder stays visible */
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  const data = loaded?.asset === asset ? loaded : null;

  // Zoom and pan are shared with every other region map (see `useZoomPan`).
  const base = useMemo<[number, number, number, number]>(
    () => data?.markers.viewBox ?? [0, 0, 1, 1],
    [data],
  );
  const { svgRef, view, zoom, size, pxPerUnit, zoomIn, zoomOut, reset, fitTo, panned, handlers } = useZoomPan(
    base,
    asset,
  );
  // The generated maps draw the country outline as a single unfilled
  // `data-role="coastline"` path. Pulled out and drawn as a real filled shape
  // here so the landmass reads as a country with a defined border, rather
  // than a faint floating squiggle, and so the rest of the source SVG
  // (context outline, group highlights) can still be layered under the pins.
  const coastline = data?.svg.match(/<path\s+d="([^"]+)"[^>]*data-role="coastline"/)?.[1] ?? null;

  /** Bounding box of each landmass the coastline actually draws. */
  const landBoxes = useMemo(() => {
    if (!coastline) return [];
    return coastline
      .split("Z")
      .filter((s) => s.trim())
      .map((sub) => {
        const pts = [...sub.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        if (!pts.length) return null;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      })
      .filter((b): b is { x0: number; x1: number; y0: number; y1: number } => b !== null);
  }, [coastline]);

  const decorations = useMemo(() => {
    if (!data) return "";
    return data.svg
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<g data-marker-name="[^"]*"[\s\S]*?<\/g>/g, "")
      .replace(/<path\s+[^>]*data-role="coastline"[^>]*\/>/g, "");
  }, [data]);

  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);

  /** Every pin the map can show, tied to its place where it has one. */
  const allPins = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: { marker: MapMarker; place: CoreBundle["places"][number] | undefined; key: string; cx: number; cy: number }[] = [];
    for (const marker of data.markers.markers) {
      const place = placeByName.get(marker.name.toLowerCase());
      // A pin that is neither a supported place nor a country grouping cannot
      // be selected, so it is not drawn at all.
      if (!place && !(marker.level === 0 && marker.aggregate)) continue;
      // The generated marker files can repeat a place; one pin per place.
      if (place) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
      }
      out.push({ marker, place, key: markerKey(marker), cx: marker.cx, cy: marker.cy });
    }
    return out;
  }, [data, placeByName]);

  /** Pins that stand for a place the traveller can pick. */
  const selectable = useMemo(
    () => allPins.filter((p): p is typeof p & { place: NonNullable<typeof p.place> } => Boolean(p.place)),
    [allPins],
  );

  const metrics = pinMetrics(size.width || 1024);

  // Which pins to draw: only those that fit without touching at this screen
  // size and zoom, countries first and their places as there is room.
  const selection = useMemo(() => {
    if (!size.width) return null;
    const pins: DeclutterPin[] = allPins.map((p) => ({
      id: p.key,
      x: p.cx,
      y: p.cy,
      country: p.marker.country,
      level: p.marker.level,
      rank: p.marker.rank,
      // A place already chosen must never disappear from under the traveller.
      pinned: p.place ? selectedSet.has(p.place.id) : false,
    }));
    return selectVisiblePins({ pins, pxPerUnit, widthPx: size.width, heightPx: size.height, zoom });
  }, [allPins, selectedSet, pxPerUnit, size.width, size.height, zoom]);

  const shown = useMemo(
    () => (selection ? allPins.filter((p) => selection.visible.has(p.key)) : []),
    [selection, allPins],
  );

  const labelSides = useMemo(
    () =>
      placePinLabels(
        [...shown]
          .sort((a, b) => a.marker.level - b.marker.level || a.marker.rank - b.marker.rank)
          .map((p) => ({
            id: p.key,
            px: (p.cx - view.x) * pxPerUnit,
            py: (p.cy - view.y) * pxPerUnit,
            text: p.marker.level === 0 ? (p.marker.label ?? p.marker.name) : p.marker.name,
          })),
        metrics.radiusPx,
      ),
    [shown, view.x, view.y, pxPerUnit, metrics.radiusPx],
  );
  /**
   * Island nations are too small to survive the map simplification — Mauritius
   * and Seychelles vanish entirely from Africa's coastline — so their pins
   * would float in open sea with nothing to say which country they belong to.
   * Where a country's pins sit outside every landmass the map actually drew,
   * enclose them in a labelled territory boundary instead, so every country on
   * the map carries some border.
   */
  const territories = useMemo(() => {
    if (!selectable.length) return [];
    const byCountry = new Map<string, { cx: number; cy: number }[]>();
    for (const { place, cx, cy } of selectable) {
      const list = byCountry.get(place.countryId);
      if (list) list.push({ cx, cy });
      else byCountry.set(place.countryId, [{ cx, cy }]);
    }

    const out: { countryId: string; name: string; cx: number; cy: number; rx: number; ry: number }[] = [];
    for (const [countryId, pts] of byCountry) {
      const onLand = pts.some((p) =>
        landBoxes.some((b) => p.cx >= b.x0 - 4 && p.cx <= b.x1 + 4 && p.cy >= b.y0 - 4 && p.cy <= b.y1 + 4),
      );
      if (onLand) continue;
      const xs = pts.map((p) => p.cx);
      const ys = pts.map((p) => p.cy);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      // A pin's bulb is drawn ~18 units *above* its anchor point, so padding
      // by the pin height keeps the ring clear of the pins it encloses rather
      // than cutting through them.
      const pad = 20;
      out.push({
        countryId,
        name: countryName.get(countryId) ?? "",
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        rx: (x1 - x0) / 2 + pad,
        ry: (y1 - y0) / 2 + pad,
      });
    }
    return out;
  }, [selectable, landBoxes, countryName]);

  return (
    <div className="relative h-full w-full">
      <button
        type="button"
        onClick={onBack}
        className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm"
        style={{ borderColor: "var(--hairline)", background: "color-mix(in srgb, var(--deep) 70%, transparent)" }}
      >
        ‹ All regions
      </button>

      {!data && (
        <p className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
          Loading…
        </p>
      )}

      {data && (
        <>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN + 0.001}
              aria-label="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded-full border text-sm font-medium backdrop-blur-sm disabled:opacity-35"
              style={{ borderColor: "var(--hairline)", background: "color-mix(in srgb, var(--deep) 70%, transparent)" }}
            >
              −
            </button>
            <button type="button" onClick={reset} aria-label="Reset zoom" className="min-w-9 text-center text-[11px] tabular-nums" style={{ color: "var(--muted)" }}>
              {zoom.toFixed(1)}×
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX - 0.001}
              aria-label="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded-full border text-sm font-medium backdrop-blur-sm disabled:opacity-35"
              style={{ borderColor: "var(--hairline)", background: "color-mix(in srgb, var(--deep) 70%, transparent)" }}
            >
              +
            </button>
          </div>

          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            className={`h-full w-full${zoom > 1 ? " cursor-grab active:cursor-grabbing" : ""}`}
            role="group"
            aria-label="Selectable places"
            style={{ touchAction: "none" }}
            {...handlers}
          >
            {/* Country boundary: filled so the landmass reads as solid ground
                with a defined border, instead of a faint outline the pins
                appear to float over. Round joins *and* caps matter here more
                than cosmetically: a genuinely tiny country (Mauritius and the
                Seychelles are both under a pixel across on Africa's map) has
                a real but near-zero-area outline, which a plain stroke can
                render as nothing at all. A round cap still draws a small dot
                at a degenerate path's vertices, so the island stays visible
                at its true position instead of needing a synthetic marker. */}
            {coastline && (
              <path
                d={coastline}
                fill="color-mix(in srgb, var(--muted) 14%, transparent)"
                stroke="var(--muted)"
                strokeWidth={1.4 / zoom}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}

            {/* Whatever else the generated map carries (context outline, group
                highlights). Its own marker <g> elements are stripped so we can
                draw richer pins on top without double rendering or
                double hit-testing. */}
            <g opacity={0.55} pointerEvents="none" dangerouslySetInnerHTML={{ __html: decorations }} />

            {/* Territory boundary for island nations the map is too coarse to
                draw, so no country's pins sit in unmarked open sea. */}
            {territories.map((t) => (
              <g key={t.countryId} pointerEvents="none">
                <ellipse
                  cx={t.cx}
                  cy={t.cy}
                  rx={t.rx}
                  ry={t.ry}
                  fill="color-mix(in srgb, var(--muted) 8%, transparent)"
                  stroke="var(--muted)"
                  strokeWidth={0.9 / zoom}
                  strokeDasharray={`${4 / zoom},${3 / zoom}`}
                  opacity={0.7}
                />
                {t.name && (
                  <text
                    x={t.cx}
                    y={t.cy - t.ry - 5 / zoom}
                    textAnchor="middle"
                    fontSize={9 / zoom}
                    fontWeight={600}
                    letterSpacing={0.4 / zoom}
                    fill="var(--muted)"
                  >
                    {t.name.toUpperCase()}
                  </text>
                )}
              </g>
            ))}

            {shown.map(({ marker, place, key, cx, cy }) => {
              const k = 1 / pxPerUnit;
              const side = labelSides.get(key);

              // A country grouping with no place of its own: a bubble that
              // zooms into the country, never something to select.
              if (!place) {
                const box = countryBox(data!.markers.markers, marker.country);
                const name = marker.label ?? marker.name;
                const isHover = hoveredCountry === marker.country;
                return (
                  <g
                    key={key}
                    transform={`translate(${cx}, ${cy}) scale(${k})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${name} — ${marker.count ?? 0} places, zoom in`}
                    className="cursor-pointer"
                    style={{ outline: "none" }}
                    onMouseEnter={() => setHoveredCountry(marker.country)}
                    onMouseLeave={() => setHoveredCountry(null)}
                    onFocus={() => setHoveredCountry(marker.country)}
                    onBlur={() => setHoveredCountry(null)}
                    onClick={() => !panned.current && box && fitTo(box, 36)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && box) {
                        e.preventDefault();
                        fitTo(box, 36);
                      }
                    }}
                  >
                    <title>{`${name} · ${marker.count ?? 0} places — click to zoom in`}</title>
                    <circle r={metrics.radiusPx} fill="transparent" />
                    <circle r={metrics.radiusPx * 0.8} fill="var(--accent)" fillOpacity={isHover ? 1 : 0.85} stroke="var(--deep)" strokeWidth={1.5} />
                    <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--deep)" pointerEvents="none">
                      {marker.count}
                    </text>
                    {(side || isHover) && (
                      <text
                        x={(side ?? "right") === "right" ? metrics.radiusPx + 3 : -(metrics.radiusPx + 3)}
                        y={4}
                        textAnchor={(side ?? "right") === "right" ? "start" : "end"}
                        fontSize={11}
                        fontWeight={700}
                        fill="var(--text)"
                        stroke="var(--deep)"
                        strokeWidth={3}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {name}
                      </text>
                    )}
                  </g>
                );
              }

              const isSelected = selectedSet.has(place.id);
              const entry = selectability.get(place.id);
              const isDisabled = !isSelected && entry?.allowed === false;
              const disabledReason = entry?.reason ?? "Not realistically combinable with your current selection";
              const isHovered = !isDisabled && hoveredPlace === place.id;
              const showLabel = isSelected || isHovered || side != null;
              const labelSide = side ?? "right";
              const label = marker.level === 0 ? (marker.label ?? marker.name) : place.name;
              const reach = metrics.radiusPx + 2;

              return (
                <g
                  key={key}
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-disabled={isDisabled}
                  aria-label={isDisabled ? `${place.name} — ${disabledReason}` : place.name}
                  tabIndex={isDisabled ? -1 : 0}
                  className={isDisabled ? "cursor-not-allowed" : "cursor-pointer"}
                  style={{ outline: "none" }}
                  onMouseEnter={() => !isDisabled && onHoverPlace(place.id)}
                  onMouseLeave={() => onHoverPlace(null)}
                  onFocus={() => !isDisabled && onHoverPlace(place.id)}
                  onBlur={() => onHoverPlace(null)}
                  onClick={() => !isDisabled && !panned.current && onToggle(place.id)}
                  onKeyDown={(e) => {
                    if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onToggle(place.id);
                    }
                  }}
                  transform={`translate(${cx}, ${cy}) scale(${k})`}
                >
                  <title>{isDisabled ? disabledReason : place.name}</title>
                  {/* Hit target: the enforced spacing guarantees it never overlaps a neighbour's. */}
                  <circle cy={-8} r={metrics.radiusPx} fill="transparent" />
                  {showLabel && (
                    <text
                      x={labelSide === "right" ? reach + 4 : -(reach + 4)}
                      y={-5}
                      textAnchor={labelSide === "right" ? "start" : "end"}
                      fontSize={11}
                      fontWeight={700}
                      fill="var(--text)"
                      stroke="var(--deep)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      pointerEvents="none"
                    >
                      {marker.level === 0 && isHovered && marker.count
                        ? `${label} · ${marker.count} places — zoom in for cities`
                        : label}
                    </text>
                  )}
                  <g transform={`scale(${PIN_SCALE})`} opacity={isDisabled ? 0.3 : 1}>
                    <path
                      d={PIN_PATH}
                      fill={isSelected ? "var(--accent)" : isHovered ? "color-mix(in srgb, var(--accent) 55%, var(--surface))" : "var(--surface)"}
                      stroke={isDisabled ? "var(--muted)" : "var(--accent)"}
                      strokeWidth={isSelected || isHovered ? 2 : 1.4}
                    />
                    <circle cx={0} cy={-18} r={3.4} fill={isSelected ? "var(--deep)" : "var(--accent)"} />
                    {isSelected && (
                      <path
                        d="M-3.2,-18 L-1,-15.5 L3.4,-20.5"
                        fill="none" stroke="var(--deep)" strokeWidth={1.4}
                        strokeLinecap="round" strokeLinejoin="round"
                      />
                    )}
                  </g>
                </g>
              );
            })}          </svg>
        </>
      )}
    </div>
  );
}
