/**
 * Fetches a real photo (and a one-line description) for every place on the
 * destination maps, from Wikipedia / Wikimedia Commons.
 *
 * Run by hand, not at build time: `npm run fetch-place-photos`. It writes
 *   public/places/<destination>/<place>.webp   (640px wide, committed)
 *   content/place-photos.json                  (credit + licence per photo)
 * and skips places it already has, so re-running only fills gaps.
 *
 * A Wikipedia article only counts as a match when its coordinates are within
 * MAX_DISTANCE_KM of our own pin, so "Florence" can never resolve to
 * Florence, Alabama. Places with no confident match get no photo here; the
 * site falls back to their package's own image instead.
 *
 * Every photo is freely licensed, and most licences require credit, so the
 * photographer and licence are stored and shown next to the image.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CONTENT = path.join(process.cwd(), "content");
const OUT = path.join(process.cwd(), "public", "places");
const MANIFEST = path.join(CONTENT, "place-photos.json");
/** Photos a person reviewed and rejected (a coin, a portrait, a satellite view); never fetched again. */
const REJECTS = path.join(CONTENT, "place-photo-rejects.json");
const UA = "RetroHolidaysSite/1.0 (place photo build script; info@retroholidays.in)";
const MAX_DISTANCE_KM = 150;
const WIDTH = 640;
const CONCURRENCY = 2;
/** Pause between requests per worker; Wikimedia rate-limits bursts (HTTP 429). */
const PAUSE_MS = 350;

export type PlacePhoto = {
  src: string;
  /** Article lead sentence, used when we have no description of our own. */
  description?: string;
  credit: string;
  license: string;
  /** Commons file page, for attribution. */
  source: string;
};

type Marker = { name: string; lat: number; lng: number; country?: string };

export const placeKey = (dest: string, name: string) => `${dest}/${slug(name)}`;
function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function km(a: [number, number], b: [number, number]): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 1500 * 2 ** attempt)));
  }
  return null;
}

type Summary = {
  type: string;
  title: string;
  extract?: string;
  coordinates?: { lat: number; lon: number };
  originalimage?: { source: string };
  thumbnail?: { source: string };
};

async function findArticle(m: Marker): Promise<Summary | null> {
  const country = m.country?.replace(/\s*cluster\s*\d+$/i, "").trim();
  const candidates = [m.name, country ? `${m.name}, ${country}` : null, country ? `${m.name} (${country})` : null].filter(
    (c): c is string => !!c,
  );
  for (const title of candidates) {
    const s = (await getJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    )) as Summary | null;
    if (!s || s.type === "disambiguation" || !s.originalimage) continue;
    if (s.coordinates) {
      if (km([m.lat, m.lng], [s.coordinates.lat, s.coordinates.lon]) > MAX_DISTANCE_KM) continue;
    } else if (!country || !s.extract?.toLowerCase().includes(country.toLowerCase())) {
      // No coordinates to check against: only trust it if it names our country.
      continue;
    }
    return s;
  }
  return null;
}

/** Lead images that are not photographs of the place: flags, maps, seals, collages. */
const NOT_A_PHOTO = /flag|map|locator|locale|location|coat_of_arms|coa_|seal|emblem|logo|montage|collage|dimos|lippu|_in_[A-Z]|\.svg/i;

const fileOf = (url: string) => {
  // Either .../commons/a/ab/File.jpg or a resized .../commons/thumb/a/ab/File.jpg/1280px-File.jpg
  const parts = url.split("?")[0].split("/");
  return decodeURIComponent((parts.includes("thumb") ? parts[parts.length - 2] : parts[parts.length - 1]) ?? "");
};

/** The lead image if it is a photograph, else the first photograph in the article. */
async function photoFor(article: Summary): Promise<string | null> {
  const lead = article.originalimage?.source;
  if (lead && !NOT_A_PHOTO.test(fileOf(lead))) return lead;
  const media = (await getJson(
    `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(article.title.replace(/ /g, "_"))}`,
  )) as { items?: { type: string; title?: string; srcset?: { src: string }[] }[] } | null;
  for (const item of media?.items ?? []) {
    if (item.type !== "image" || !item.title || NOT_A_PHOTO.test(item.title) || !/\.jpe?g$/i.test(item.title)) continue;
    const src = item.srcset?.[item.srcset.length - 1]?.src;
    if (src) return src.startsWith("//") ? `https:${src}` : src;
  }
  return null;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function licenceFor(imageUrl: string): Promise<{ credit: string; license: string; source: string } | null> {
  const file = fileOf(imageUrl);
  if (!file) return null;
  const data = (await getJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=File:${encodeURIComponent(file)}`,
  )) as { query?: { pages?: Record<string, { imageinfo?: { extmetadata?: Record<string, { value: string }> }[] }> } } | null;
  const page = data?.query?.pages ? Object.values(data.query.pages)[0] : undefined;
  const meta = page?.imageinfo?.[0]?.extmetadata;
  if (!meta) return null;
  const license = stripHtml(meta.LicenseShortName?.value ?? "");
  // Only freely licensed images; skip fair-use or unknown.
  if (!/^(CC|Public domain|PD)/i.test(license)) return null;
  return {
    credit: stripHtml(meta.Artist?.value ?? "Unknown").slice(0, 80) || "Unknown",
    license,
    source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
  };
}

function firstSentences(text: string, max = 220): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    if ((out + " " + p).trim().length > max) break;
    out = (out + " " + p).trim();
  }
  return out || text.slice(0, max);
}

async function main() {
  const manifest: Record<string, PlacePhoto> = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf-8")) : {};
  const rejected = new Set<string>(existsSync(REJECTS) ? JSON.parse(readFileSync(REJECTS, "utf-8")) : []);
  const jobs: { dest: string; m: Marker }[] = [];
  for (const f of readdirSync(path.join(CONTENT, "destinations")).filter((f) => f.endsWith(".json"))) {
    const dest = JSON.parse(readFileSync(path.join(CONTENT, "destinations", f), "utf-8"));
    for (const m of dest.map.markers as Marker[]) {
      const key = placeKey(dest.slug, m.name);
      if (!manifest[key] && !rejected.has(key)) jobs.push({ dest: dest.slug, m });
    }
  }
  console.log(`${jobs.length} places to look up (${Object.keys(manifest).length} already have photos)`);

  let found = 0, missed = 0, i = 0;
  const misses: string[] = [];
  async function worker() {
    while (i < jobs.length) {
      const { dest, m } = jobs[i++];
      try {
        const article = await findArticle(m);
        const photo = article ? await photoFor(article) : null;
        const lic = photo ? await licenceFor(photo) : null;
        if (!article || !photo || !lic) {
          missed++;
          misses.push(`${dest}: ${m.name}`);
          continue;
        }
        // Commons serves resized thumbnails; ask for one near our size.
        // Ask Commons for a resized copy near our size rather than the original.
        const thumb = /\/\d+px-/.test(photo) ? photo.replace(/\/\d+px-/, `/${WIDTH * 2}px-`) : photo;
        const res = await fetch(thumb, { headers: { "User-Agent": UA } });
        if (!res.ok) throw new Error(`image ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const dir = path.join(OUT, dest);
        mkdirSync(dir, { recursive: true });
        const file = `${slug(m.name)}.webp`;
        await sharp(buf).rotate().resize({ width: WIDTH, height: Math.round(WIDTH * 0.625), fit: "cover" }).webp({ quality: 62 }).toFile(path.join(dir, file));
        manifest[placeKey(dest, m.name)] = {
          src: `/places/${dest}/${file}`,
          description: article.extract ? firstSentences(article.extract) : undefined,
          ...lic,
        };
        found++;
      } catch (e) {
        missed++;
        misses.push(`${dest}: ${m.name} (${(e as Error).message})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`found ${found}, no confident match ${missed}`);
  writeFileSync(path.join(process.cwd(), "tmp-place-photo-misses.txt"), misses.join("\n") + "\n");
}

if (process.argv[1]?.endsWith("fetch-place-photos.ts")) main();
