"use client";

import type { Group } from "@/content/schema";
import { DestinationExplorer } from "./DestinationExplorer";
import type { RegionLayer, RegionMarkers } from "@/lib/map-svg";
import type { PlaceInfo } from "@/lib/place-images";

type Props = {
  destinationSlug: string;
  destinationName: string;
  mapSvg: string;
  mapMarkers: RegionMarkers;
  regions?: RegionLayer | null;
  groups: Group[];
  placeInfo: Record<string, PlaceInfo>;
  packageCovers: Record<number, string>;
};

/** Client boundary for the destination atlas (map + index panel). */
export function DestinationMapSection({ destinationSlug, destinationName, mapSvg, mapMarkers, regions, groups, placeInfo, packageCovers }: Props) {
  return (
    <DestinationExplorer
      destinationSlug={destinationSlug}
      destinationName={destinationName}
      mapSvg={mapSvg}
      markers={mapMarkers}
      regions={regions}
      groups={groups}
      placeInfo={placeInfo}
      packageCovers={packageCovers}
    />
  );
}
