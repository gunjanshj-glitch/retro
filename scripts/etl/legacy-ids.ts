/**
 * Stable identifiers for names the master used to misspell.
 *
 * The master once spelt these names wrongly ("Hungery", "Seol"). The data now
 * uses the standard spelling, but ids and URL slugs are still derived from the
 * old spelling: saved trip requests hold place ids, and links to
 * /destinations/... use slugs, so changing either would break them.
 *
 * The maps are per kind because a corrected country can share its new name
 * with an unrelated record of another kind (the "Philippines" package was
 * always spelt correctly and keeps its own id).
 */
import { slugify } from "./normalise";

const COUNTRY: Record<string, string> = {
  Hungary: "Hungery",
  Liechtenstein: "Linchestine",
  Kyrgyzstan: "Kyrgisthan",
  Philippines: "Phillipines",
  Scandinavia: "Scandinivia",
};

const PLACE: Record<string, string> = {
  Hungary: "Hungery",
  Liechtenstein: "Linchestine",
  Seoul: "Seol",
  "Maasai Mara": "Masaimara",
  Edinburgh: "Edinburg",
  "Nha Trang": "Nathrang",
  "Ho Chi Minh City": "Hochiminh",
  "Nuwara Eliya": "Nuwaraeliya",
  "Borneo Island": "Bornea Island",
  Phuentsholing: "Phunotsiling",
};

const PACKAGE: Record<string, string> = {
  Kyrgyzstan: "Kyrgisthan",
};

const TABLES = { country: COUNTRY, place: PLACE, package: PACKAGE } as const;

/** The name to derive an id or slug from: the old spelling where one existed. */
export function idName(kind: keyof typeof TABLES, name: string): string {
  return TABLES[kind][name.trim()] ?? name;
}

/** `slugify(idName(kind, name))`. */
export function legacySlug(kind: keyof typeof TABLES, name: string): string {
  return slugify(idName(kind, name));
}
