"use client";

/**
 * A zoomable region map: every country (or state) drawn as its own shape on a
 * sea of neighbouring land, with progressive pins on top.
 *
 * Zoomed out it shows one count bubble per grouping; zoomed in, or with a
 * grouping selected, the individual places with labels. Pins keep a constant
 * on-screen size at every zoom. The page always scrolls past the map: zooming
 * needs Ctrl/⌘ + scroll, a pinch, the buttons or a double-click (see
 * `lib/use-zoom-pan`).
 *
 * The parent owns selection (which grouping is open, which package is
 * highlighted, which place is active); this component reports hover and clicks.
 */
import { useEffect, useMemo, useState } from "react";
import { PLACE_ZOOM, pinMetrics, placePinLabels, selectVisiblePins, type DeclutterPin } from "@retro/core/map-declutter";
import { groupDisplayName, markerKey, parseRegionSvg, pointsBox, type MapMarker, type RegionLayer, type RegionMarkers } from "@/lib/map-svg";
import { useZoomPan, ZOOM_MAX, ZOOM_MIN } from "@/lib/use-zoom-pan";
import { displayName } from "@/lib/display-names";

type Props = {
  svg: string;
  markers: RegionMarkers;
  regions?: RegionLayer | null;
  /** Distinguishes one map from another so zoom resets between them. */
  mapKey: string;
  /** Groupings (marker `country` values) currently opened; the map frames them. */
  selectedGroups?: Set<string> | null;
  /** Package id whose places are highlighted, if any. */
  packageId?: number | null;
  /** Groupings being hovered in the side list. */
  hotGroups?: Set<string> | null;
  activePlace?: MapMarker | null;
  onGroupHover?: (group: string | null) => void;
  onGroupSelect?: (group: string) => void;
  onPlaceHover?: (m: MapMarker | null) => void;
  onPlaceSelect?: (m: MapMarker) => void;
  ariaLabel?: string;
};

const LABEL_FONT = 11;
const CHAR_W = 6.2;

const labelText = (m: MapMarker) => (m.level === 0 ? groupDisplayName(m.label ?? m.country) : displayName(m.name));
const labelWidth = (m: MapMarker) => labelText(m).length * CHAR_W + 4;

export function RegionMap({
  svg,
  markers,
  regions,
  mapKey,
  selectedGroups,
  packageId = null,
  hotGroups,
  activePlace,
  onGroupHover,
  onGroupSelect,
  onPlaceHover,
  onPlaceSelect,
  ariaLabel = "Map of places",
}: Props) {
  const { coastline, decorations } = useMemo(() => parseRegionSvg(svg), [svg]);
  const { svgRef, view, zoom, size, pxPerUnit, zoomIn, zoomOut, reset, fitTo, panned, hint, handlers } = useZoomPan(
    markers.viewBox,
    mapKey,
  );
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);

  const metrics = pinMetrics(size.width || 1024);
  const k = 1 / pxPerUnit;

  const places = useMemo(() => markers.markers.filter((m) => m.level === 1), [markers.markers]);

  // Frame whatever was opened: a grouping, a package, or back to everything.
  const focusKey = selectedGroups?.size ? [...selectedGroups].sort().join("|") : packageId != null ? `pkg:${packageId}` : "";
  useEffect(() => {
    if (!focusKey) {
      reset();
      return;
    }
    const pts = selectedGroups?.size
      ? places.filter((m) => selectedGroups.has(m.country))
      : places.filter((m) => m.group === packageId);
    const box = pointsBox(pts);
    if (!box) return;
    const span = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    fitTo(box, Math.max(14, span * 0.22));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the focus itself changes
  }, [focusKey]);

  // ---- which pins to draw ----------------------------------------------
  const focused = !!selectedGroups?.size || packageId != null;
  const pins: DeclutterPin[] = useMemo(
    () =>
      markers.markers.map((m) => ({ id: markerKey(m), x: m.cx, y: m.cy, country: m.country, level: m.level, rank: m.rank })),
    [markers.markers],
  );
  const selection = useMemo(
    () =>
      size.width && !focused
        ? selectVisiblePins({ pins, pxPerUnit, widthPx: size.width, heightPx: size.height, zoom })
        : null,
    [pins, pxPerUnit, size.width, size.height, zoom, focused],
  );
  // Zoomed all the way out, every area keeps a mark: a count bubble where it
  // has room, a small dot where it is crowded (no area silently disappears).
  const overview = !focused && zoom < PLACE_ZOOM;
  const { visible, compact } = useMemo(() => {
    if (selectedGroups?.size) return { visible: places.filter((m) => selectedGroups.has(m.country)), compact: new Set<string>() };
    if (packageId != null) return { visible: places.filter((m) => m.group === packageId), compact: new Set<string>() };
    if (overview && size.width) {
      const groupsWithPin = new Set(markers.markers.filter((m) => m.level === 0).map((m) => m.country));
      const all = markers.markers
        .filter((m) => m.level === 0 || !groupsWithPin.has(m.country))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      const room = (metrics.radiusPx + 2) * 2 + 4;
      const placed: [number, number][] = [];
      const small = new Set<string>();
      for (const m of all) {
        const px = (m.cx - view.x) * pxPerUnit, py = (m.cy - view.y) * pxPerUnit;
        if (placed.some(([x, y]) => Math.hypot(x - px, y - py) < room)) small.add(markerKey(m));
        else placed.push([px, py]);
      }
      return { visible: all, compact: small };
    }
    return {
      visible: selection ? markers.markers.filter((m) => selection.visible.has(markerKey(m))) : [],
      compact: new Set<string>(),
    };
  }, [selection, markers.markers, places, selectedGroups, packageId, overview, size.width, view.x, view.y, pxPerUnit, metrics.radiusPx]);

  const labelSides = useMemo(
    () =>
      placePinLabels(
        [...visible]
          .filter((m) => !compact.has(markerKey(m)))
          .sort((a, b) => a.level - b.level || (b.count ?? 0) - (a.count ?? 0) || a.rank - b.rank)
          .map((m) => ({
            id: markerKey(m),
            px: (m.cx - view.x) * pxPerUnit,
            py: (m.cy - view.y) * pxPerUnit,
            text: m.level === 0 ? groupDisplayName(m.label ?? m.country) : displayName(m.name),
          })),
        metrics.radiusPx,
      ),
    [visible, compact, view.x, view.y, pxPerUnit, metrics.radiusPx],
  );

  // ---- country / state shapes ------------------------------------------
  const pkgGroups = useMemo(
    () => (packageId == null ? null : new Set(places.filter((m) => m.group === packageId).map((m) => m.country))),
    [packageId, places],
  );
  const unitState = (groups: string[], name: string) => {
    const touches = (set?: Set<string> | null) => !!set && groups.some((g) => set.has(g));
    if (selectedGroups?.size) return touches(selectedGroups) ? "on" : "dim";
    if (pkgGroups) return touches(pkgGroups) ? "on" : "dim";
    if (hoverUnit === name || touches(hotGroups)) return "hot";
    if (!groups.length) return "dim";
    return undefined;
  };
  const unitGroup = (groups: string[], name: string) =>
    groups.find((g) => g.toLowerCase() === name.toLowerCase()) ?? groups[0] ?? null;

  const clickPin = (m: MapMarker) => {
    if (panned.current) return;
    if (m.level === 0) onGroupSelect?.(m.country);
    else onPlaceSelect?.(m);
  };


  return (
    <div className="relative h-full w-full select-none" style={{ background: "linear-gradient(180deg, var(--sea-2) 0%, var(--sea) 100%)" }}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={`h-full w-full${zoom > 1.01 ? " cursor-grab active:cursor-grabbing" : ""}`}
        role="group"
        aria-label={ariaLabel}
        style={{ touchAction: "pan-y" }}
        {...handlers}
      >
        {/* Geography first: the neighbouring land sits under the places we visit,
            so countries keep their real position and shape instead of floating
            apart. Visited countries are warm; their neighbours stay quiet. */}
        {regions?.context && <path d={regions.context} className="map-context" />}
        {coastline && (
          <path
            d={coastline}
            fill="var(--land-visited)"
            stroke="var(--land-visited-edge)"
            strokeWidth={1.3 * k}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {regions?.islets && (
          <path d={regions.islets} fill="var(--land-visited)" stroke="var(--land-visited-edge)" strokeWidth={1.3 * k} pointerEvents="none" />
        )}
        <g opacity={0.55} pointerEvents="none" dangerouslySetInnerHTML={{ __html: decorations }} />

        {regions?.units.map((u) => {
          const group = unitGroup(u.groups, u.name);
          const state = unitState(u.groups, u.name);
          return (
            <path
              key={u.name}
              d={u.d}
              className="map-country"
              data-state={state}
              data-unit={u.name}
              style={!u.groups.length ? { cursor: "default" } : undefined}
              onPointerEnter={() => {
                if (!group) return;
                setHoverUnit(u.name);
                onGroupHover?.(group);
              }}
              onPointerLeave={() => {
                setHoverUnit(null);
                onGroupHover?.(null);
              }}
              onClick={() => {
                if (panned.current || !group) return;
                onGroupSelect?.(group);
              }}
            >
              <title>{u.places ? `${u.name} · ${u.places} ${u.places === 1 ? "place" : "places"}` : u.name}</title>
            </path>
          );
        })}

        {visible.map((m) => {
          const key = markerKey(m);
          // Keep labels on the map: flip to the other side, or drop, at the edges.
          let side = labelSides.get(key);
          if (side) {
            const px = (m.cx - view.x) * pxPerUnit;
            const need = labelWidth(m) + metrics.radiusPx + 10;
            if (side === "right" && px + need > size.width) side = px - need >= 0 ? "left" : undefined;
            else if (side === "left" && px - need < 0) side = px + need <= size.width ? "right" : undefined;
          }
          const isGroup = m.level === 0;
          const hot = isGroup ? !!hotGroups?.has(m.country) : activePlace ? markerKey(activePlace) === key : false;
          const text = labelText(m);
          const small = compact.has(key);
          const dotR = metrics.radiusPx * 0.55;
          const r = small ? dotR : isGroup ? dotR * 1.45 : dotR;
          return (
            <g
              key={key}
              transform={`translate(${m.cx}, ${m.cy}) scale(${k})`}
              className="cursor-pointer"
              data-marker-name={m.name}
              data-marker-level={m.level}
              onPointerEnter={() => (isGroup ? onGroupHover?.(m.country) : onPlaceHover?.(m))}
              onPointerLeave={() => (isGroup ? onGroupHover?.(null) : onPlaceHover?.(null))}
              onFocus={() => (isGroup ? onGroupHover?.(m.country) : onPlaceHover?.(m))}
              onBlur={() => (isGroup ? onGroupHover?.(null) : onPlaceHover?.(null))}
              onClick={(e) => {
                e.stopPropagation();
                clickPin(m);
              }}
              tabIndex={0}
              role="button"
              aria-label={isGroup ? `${text}, ${m.count ?? 0} places` : text}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  clickPin(m);
                }
              }}
              style={{ outline: "none" }}
            >
              {/* Generous invisible target, never wider than the enforced spacing allows. */}
              <circle r={metrics.radiusPx + 4} fill="transparent" />
              {isGroup && !small ? (
                <>
                  <circle r={r} fill="var(--sun)" stroke={hot ? "var(--ink)" : "var(--sun-deep)"} strokeWidth={hot ? 2 : 1.5} />
                  {m.count != null && (
                    <text y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="var(--on-sun)" pointerEvents="none">
                      {m.count}
                    </text>
                  )}
                </>
              ) : (
                <circle
                  r={hot ? r * 1.35 : r}
                  fill={hot || isGroup ? "var(--sun)" : "var(--muted)"}
                  stroke={hot || isGroup ? "var(--sun-deep)" : "var(--bg)"}
                  strokeWidth={1.5}
                />
              )}
              {side && (
                <text
                  x={side === "right" ? r + 4 : -(r + 4)}
                  y={0.5}
                  dominantBaseline="central"
                  textAnchor={side === "right" ? "start" : "end"}
                  fontSize={LABEL_FONT}
                  fontWeight={isGroup || hot ? 700 : 600}
                  fill={isGroup || hot ? "var(--text)" : "var(--muted)"}
                  stroke="var(--bg)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Scroll hint: shown briefly when someone scrolls over the map. */}
      <div
        className="map-hint pointer-events-none absolute inset-0 z-20 grid place-items-center p-4 text-center text-base font-bold text-white sm:text-lg"
        style={{ background: "var(--scrim)" }}
        data-show={hint === "wheel"}
        aria-hidden="true"
      >
        Hold Ctrl or ⌘ and scroll to zoom the map
      </div>

      <div className="absolute right-3 bottom-3 z-10 grid gap-2 sm:right-4 sm:bottom-4">
        <MapButton label="Zoom in" onClick={zoomIn} disabled={zoom >= ZOOM_MAX - 0.001}>
          <path d="M12 5v14M5 12h14" />
        </MapButton>
        <MapButton label="Zoom out" onClick={zoomOut} disabled={zoom <= ZOOM_MIN + 0.001}>
          <path d="M5 12h14" />
        </MapButton>
        <MapButton label="Show the whole map" onClick={reset} disabled={zoom <= ZOOM_MIN + 0.001}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-[14px] transition-colors hover:bg-[var(--surface)] disabled:cursor-default disabled:opacity-40"
      style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow)" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
