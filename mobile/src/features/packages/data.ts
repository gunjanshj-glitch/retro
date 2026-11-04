import { SITE_URL } from "@/lib/env";

/** Mirrors `public/atlas/package-cards.json`, published by the website build. */
export type PackageCard = {
  id: string;
  name: string;
  slug: string;
  destinationSlug: string;
  regionId: string;
  nights: number;
  days: number;
  priceFromInr: number;
  priceIncludesFlight: boolean;
  tagline: string | null;
  coverImage: string;
};

export async function fetchPackages(): Promise<PackageCard[]> {
  const res = await fetch(`${SITE_URL}/atlas/package-cards.json`);
  if (!res.ok) throw new Error(`Packages ${res.status}`);
  return (await res.json()) as PackageCard[];
}
