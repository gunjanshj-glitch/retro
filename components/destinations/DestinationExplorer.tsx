"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getPlaceImageUrl, getPlaceDescription } from "@/lib/place-images";
import { classifyGroupThemes } from "@/lib/group-themes";
import { RegionMap } from "@/components/map/RegionMap";
import type { MapMarker, RegionMarkers } from "@/lib/map-svg";
import type { Group } from "@/content/schema";

type Props = {
  destinationSlug: string;
  mapSvg: string;
  markers: RegionMarkers;
  groups?: Group[];
  // When set, dims all markers not belonging to this group.
  selectedGroupId?: number;
};

type TooltipPos = { x: number; y: number; flip: boolean };

export function DestinationExplorer({ destinationSlug, mapSvg, markers, groups = [], selectedGroupId }: Props) {
  const [hovered, setHovered] = useState<MapMarker | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);
  const router = useRouter();

  const vbW = markers.viewBox[2];
  const vbH = markers.viewBox[3];

  const groupOf = (m: MapMarker | null) =>
    m?.group != null ? groups.find((g) => g.id === m.group) : undefined;

  const goToPackage = (m: MapMarker) => {
    const group = groupOf(m);
    router.push(group ? `/destinations/${destinationSlug}/packages/${group.packageSlug}` : `/destinations/${destinationSlug}`);
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltipPos({ x, y, flip: x > rect.width * 0.55 });
  };

  const group = groupOf(hovered);
  const isCountryPin = hovered?.level === 0;
  const countryName = hovered ? (hovered.label ?? hovered.name) : "";
  // A country pin whose name is the package's own label (Kerala, Vietnam) shows
  // that package; otherwise it shows country information.
  const countryIsGroup = isCountryPin && group && normalise(group.name) === normalise(countryName);

  const showTooltip = hovered && tooltipPos;
  const placeImage = hovered && !group ? getPlaceImageUrl(destinationSlug, hovered.name) : null;
  const placeDescription = hovered && !group ? getPlaceDescription(destinationSlug, hovered.name) : null;

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border"
      style={{
        borderColor: "var(--hairline)",
        aspectRatio: `${vbW} / ${vbH}`,
        maxHeight: "82vh",
        minHeight: 360,
      }}
      onMouseMove={onMove}
    >
      <RegionMap
        svg={mapSvg}
        markers={markers}
        mapKey={destinationSlug}
        onHover={(m) => setHovered(m)}
        onPlaceClick={goToPackage}
        pinVisual={(m) => ({
          active: hovered != null && hovered.name === m.name && hovered.level === m.level,
          dimmed: selectedGroupId != null && m.group != null && m.group !== selectedGroupId,
        })}
      />

      {showTooltip && (
        <div
          className="pointer-events-none absolute z-30"
          style={{
            top: tooltipPos.y,
            left: tooltipPos.x,
            transform: tooltipPos.flip ? "translate(calc(-100% - 18px), -50%)" : "translate(18px, -50%)",
            width: group || isCountryPin ? "240px" : "216px",
            borderRadius: "14px",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.13)",
            background: "rgba(9, 24, 28, 0.82)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(111,227,196,0.06), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {isCountryPin && !countryIsGroup ? (
            <CountryTooltip
              marker={hovered}
              group={group}
              imageUrl={getPlaceImageUrl(destinationSlug, countryName)}
            />
          ) : group ? (
            <GroupTooltip group={group} placeName={isCountryPin ? countryName : hovered.name} />
          ) : (
            <PlaceTooltip name={hovered.name} imageUrl={placeImage!} description={placeDescription!} />
          )}
        </div>
      )}
    </div>
  );
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/* ── Country card: what a zoomed-out country pin shows ───────── */
function CountryTooltip({ marker, group, imageUrl }: { marker: MapMarker; group?: Group; imageUrl: string }) {
  const name = marker.label ?? marker.name;
  const places = marker.places ?? [];
  const count = marker.count ?? places.length;
  return (
    <>
      <div style={{ position: "relative", height: "112px", overflow: "hidden" }}>
        <img src={imageUrl} alt={name} loading="eager" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        <div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 40%, rgba(9,24,28,0.75) 100%)" }}
        />
      </div>
      <div style={{ padding: "12px 16px 14px" }}>
        <p style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "5px" }}>
          Country · {count} {count === 1 ? "place" : "places"}
        </p>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--text)", lineHeight: 1.1, marginBottom: "8px" }}>
          {name}
        </p>
        {places.length > 0 && (
          <p style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>Includes: </span>
            {places.slice(0, 6).join(", ")}
            {count > 6 && ` +${count - 6} more`}
          </p>
        )}
        {group && (
          <p style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.5, marginTop: "6px" }}>
            Part of <span style={{ color: "var(--text)" }}>{group.packageName}</span>
          </p>
        )}
        <div style={{ marginTop: "10px", paddingTop: "9px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)" }}>
            Click to zoom in
          </span>
          <span style={{ fontSize: "13px", color: "var(--accent)" }}>+</span>
        </div>
      </div>
    </>
  );
}

/* ── Group offer card ─────────────────────────────────── */
function GroupTooltip({ group, placeName }: { group: Group; placeName: string }) {
  const { offer } = group;
  const imageUrl = getPlaceImageUrl(group.packageSlug, placeName);
  const themes = classifyGroupThemes(group);
  // Cities/places this state (or country) pointer stands in for — shown so a
  // single collapsed pin still communicates everywhere it covers.
  const cities = group.places;

  return (
    <div>
      {/* Photo */}
      <div style={{ position: "relative", height: "120px", overflow: "hidden" }}>
        <img
          src={imageUrl}
          alt={placeName}
          loading="eager"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, transparent 45%, rgba(9,24,28,0.7) 100%)",
          }}
        />
        {themes.length > 0 && (
          <div style={{ position: "absolute", top: "8px", left: "8px", display: "flex", gap: "5px", flexWrap: "wrap" }}>
            {themes.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--text)",
                  background: "rgba(9,24,28,0.6)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "999px",
                  padding: "3px 8px",
                  backdropFilter: "blur(6px)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "14px 16px 16px" }}>
      {/* Label: which place was hovered */}
      <p style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "6px" }}>
        {placeName}
      </p>

      {/* Package name */}
      <p style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 400, color: "var(--text)", lineHeight: 1.1, marginBottom: "4px" }}>
        {group.packageName}
      </p>

      {/* Group tagline */}
      {group.tagline && (
        <p style={{ fontSize: "11.5px", color: "var(--muted)", lineHeight: 1.45, marginBottom: "10px" }}>
          {group.tagline}
        </p>
      )}

      {/* Cities/places covered by this pin */}
      {cities.length > 0 && (
        <p style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "12px" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Covers: </span>
          {cities.slice(0, 6).join(", ")}
          {cities.length > 6 && ` +${cities.length - 6} more`}
        </p>
      )}

      {offer && (
        <>
          {/* Price + days */}
          {(offer.days || offer.price_from_usd) && (
            <div style={{ display: "flex", gap: "12px", marginBottom: "10px" }}>
              {offer.days && (
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>
                  {offer.days} days
                </span>
              )}
              {offer.price_from_usd && (
                <span style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600 }}>
                  from ₹{offer.price_from_usd.toLocaleString("en-IN")}
                  {!offer.price_includes_flight && (
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}> + flights</span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Highlights */}
          {offer.highlights && offer.highlights.length > 0 && (
            <>
              <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", marginBottom: "10px" }} />
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {offer.highlights.slice(0, 3).map((h) => (
                  <li key={h} style={{ display: "flex", gap: "7px", alignItems: "flex-start", marginBottom: "5px" }}>
                    <span style={{ fontSize: "9px", color: "var(--accent)", marginTop: "3px", flexShrink: 0 }}>▸</span>
                    <span style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.4 }}>{h}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* CTA */}
      <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)" }}>
          View package
        </span>
        <span style={{ fontSize: "13px", color: "var(--accent)" }}>→</span>
      </div>
      </div>
    </div>
  );
}

/* ── Per-place image card ─────────────────────────────── */
function PlaceTooltip({ name, imageUrl, description }: { name: string; imageUrl: string; description: string }) {
  return (
    <>
      {/* Photo */}
      <div style={{ position: "relative", height: "144px", overflow: "hidden" }}>
        <img
          src={imageUrl}
          alt={name}
          loading="eager"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, transparent 45%, rgba(9,24,28,0.65) 100%)",
          }}
        />
      </div>

      {/* Body */}
      <div style={{ padding: "11px 14px 14px" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 400, color: "var(--text)", lineHeight: 1.15, marginBottom: "6px" }}>
          {name}
        </p>
        <p style={{ fontSize: "11.5px", color: "var(--muted)", lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {description}
        </p>
        <div style={{ marginTop: "10px", paddingTop: "9px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)" }}>
            Explore
          </span>
          <span style={{ fontSize: "13px", color: "var(--accent)" }}>→</span>
        </div>
      </div>
    </>
  );
}
