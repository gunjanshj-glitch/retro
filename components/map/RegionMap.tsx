"use client";

/**
 * A zoomable region map with progressive pins.
 *
 * Draws the region outline and, over it, only the pins that fit without
 * touching (see `lib/map-declutter`): countries when zoomed out, their places
 * as the traveller zooms in. Pins keep a constant on-screen size at every zoom.
 * Used by every region map on the destination pages.
 */
import { useMemo, type ReactNode } from "react";
import { pinMetrics, placePinLabels, selectVisiblePins, type DeclutterPin } from "@/lib/map-declutter";
import { countryBox, markerKey, parseRegionSvg, type MapMarker, type RegionMarkers } from "@/lib/map-svg";
import { useZoomPan, ZOOM_MAX, ZOOM_MIN } from "@/lib/use-zoom-pan";

export type PinVisual = { dimmed?: boolean; active?: boolean };

type Props = {
  svg: string;
  markers: RegionMarkers;
  /** Distinguishes one map from another so zoom resets between them. */
  mapKey: string;
  pinVisual?: (m: MapMarker) => PinVisual;
  onHover?: (m: MapMarker | null) => void;
  /** Called for a click on a place pin. */
  onPlaceClick?: (m: MapMarker) => void;
  children?: ReactNode;
};

const controlStyle = {
  borderColor: "var(--hairline)",
  background: "color-mix(in srgb, var(--deep) 70%, transparent)",
} as const;

export function RegionMap({ svg, markers, mapKey, pinVisual, onHover, onPlaceClick, children }: Props) {
  const { coastline, decorations } = useMemo(() => parseRegionSvg(svg), [svg]);
  const { svgRef, view, zoom, size, pxPerUnit, zoomIn, zoomOut, reset, fitTo, panned, handlers } = useZoomPan(
    markers.viewBox,
    mapKey,
  );

  const metrics = pinMetrics(size.width || 1024);

  const pins: DeclutterPin[] = useMemo(
    () =>
      markers.markers.map((m) => ({
        id: markerKey(m),
        x: m.cx,
        y: m.cy,
        country: m.country,
        level: m.level,
        rank: m.rank,
      })),
    [markers.markers],
  );

  const selection = useMemo(
    () =>
      size.width
        ? selectVisiblePins({ pins, pxPerUnit, widthPx: size.width, heightPx: size.height, zoom })
        : null,
    [pins, pxPerUnit, size.width, size.height, zoom],
  );

  const visible = useMemo(
    () => (selection ? markers.markers.filter((m) => selection.visible.has(markerKey(m))) : []),
    [selection, markers.markers],
  );

  // Screen positions are only needed relative to each other for labelling.
  const labelSides = useMemo(
    () =>
      placePinLabels(
        [...visible]
          .sort((a, b) => a.level - b.level || a.rank - b.rank)
          .map((m) => ({
            id: markerKey(m),
            px: (m.cx - view.x) * pxPerUnit,
            py: (m.cy - view.y) * pxPerUnit,
            text: m.level === 0 ? (m.label ?? m.name) : m.name,
          })),
        metrics.radiusPx,
      ),
    [visible, view.x, view.y, pxPerUnit, metrics.radiusPx],
  );

  const k = 1 / pxPerUnit;
  const dotR = metrics.radiusPx * 0.55;

  const handleClick = (m: MapMarker) => {
    if (panned.current) return;
    // A country pin dives into the country; only a place pin is acted on.
    if (m.level === 0) {
      const box = countryBox(markers.markers, m.country);
      if (box) {
        fitTo(box, 36);
        return;
      }
    }
    onPlaceClick?.(m);
  };

  return (
    <div className="relative h-full w-full select-none">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN + 0.001}
          aria-label="Zoom out"
          className="flex h-7 w-7 items-center justify-center rounded-full border text-sm font-medium backdrop-blur-sm disabled:opacity-35"
          style={controlStyle}
        >
          −
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset zoom"
          className="min-w-9 rounded-full px-1 text-center text-[11px] tabular-nums"
          style={{ color: "var(--muted)" }}
        >
          {zoom.toFixed(1)}×
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX - 0.001}
          aria-label="Zoom in"
          className="flex h-7 w-7 items-center justify-center rounded-full border text-sm font-medium backdrop-blur-sm disabled:opacity-35"
          style={controlStyle}
        >
          +
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={`h-full w-full${zoom > 1 ? " cursor-grab active:cursor-grabbing" : ""}`}
        role="group"
        aria-label="Map of places"
        style={{ touchAction: "none" }}
        {...handlers}
      >
        {coastline && (
          <path
            d={coastline}
            fill="color-mix(in srgb, var(--muted) 12%, transparent)"
            stroke="var(--muted)"
            strokeWidth={1.2 * k}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        <g opacity={0.55} pointerEvents="none" dangerouslySetInnerHTML={{ __html: decorations }} />

        {visible.map((m) => {
          const key = markerKey(m);
          const state = pinVisual?.(m) ?? {};
          const side = labelSides.get(key);
          const isCountry = m.level === 0;
          const r = isCountry ? dotR * 1.45 : dotR;
          const text = isCountry ? (m.label ?? m.name) : m.name;
          return (
            <g
              key={key}
              transform={`translate(${m.cx}, ${m.cy}) scale(${k})`}
              opacity={state.dimmed ? 0.25 : 1}
              className="cursor-pointer"
              data-marker-name={m.name}
              data-marker-level={m.level}
              onMouseEnter={() => onHover?.(m)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(m)}
              onBlur={() => onHover?.(null)}
              onClick={() => handleClick(m)}
              tabIndex={0}
              role="button"
              aria-label={text}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(m);
                }
              }}
              style={{ outline: "none" }}
            >
              {/* Generous invisible target, never wider than the enforced spacing allows. */}
              <circle r={metrics.radiusPx} fill="transparent" />
              <circle
                r={r}
                fill={isCountry || state.active ? "var(--accent)" : "var(--muted)"}
                stroke="var(--deep)"
                strokeWidth={1.5}
                className="marker-dot"
              />
              {isCountry && m.count != null && (
                <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--deep)" pointerEvents="none">
                  {m.count}
                </text>
              )}
              {side && (
                <text
                  x={side === "right" ? metrics.radiusPx + 3 : -(metrics.radiusPx + 3)}
                  y={4}
                  textAnchor={side === "right" ? "start" : "end"}
                  fontSize={11}
                  fontWeight={isCountry ? 700 : 600}
                  fill={isCountry ? "var(--text)" : "var(--muted)"}
                  stroke="var(--deep)"
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
      {children}
    </div>
  );
}
