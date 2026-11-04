/**
 * Writes `public/atlas/manifest.json`: the revision stamp the mobile app checks at launch.
 *
 * Runs last in the prebuild chain, after the atlas, maps and package cards exist. It also copies the
 * engine's two hand-edited commercial files (`quote-policy.json`, `pricing-calibration.json`) next to
 * the data, so a price-policy change reaches installed apps through the same revision check instead of
 * waiting for an app release.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CatalogueManifest, ManifestFile } from "../packages/core/catalogue";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");

/** What the app needs. Planner guidance (11 MB, unused by the app) is deliberately left out. */
const INCLUDE = ["atlas/core.json", "atlas/routes.json", "atlas/visa.json", "atlas/package-cards.json", "atlas/destinations", "atlas/engine", "maps"];

function walk(rel: string): string[] {
  const abs = path.join(PUBLIC, rel);
  const stat = statSync(abs);
  if (!stat.isDirectory()) return [rel];
  return readdirSync(abs).sort().flatMap((name) => walk(`${rel}/${name}`));
}

function main() {
  mkdirSync(path.join(PUBLIC, "atlas", "engine"), { recursive: true });
  for (const name of ["quote-policy.json", "pricing-calibration.json"]) {
    copyFileSync(path.join(ROOT, "content", name), path.join(PUBLIC, "atlas", "engine", name));
  }

  const files: ManifestFile[] = INCLUDE.flatMap(walk).map((rel) => {
    const data = readFileSync(path.join(PUBLIC, rel));
    return { path: rel, bytes: data.length, hash: createHash("sha256").update(data).digest("hex").slice(0, 32) };
  });

  const revision = createHash("sha256").update(files.map((f) => `${f.path}:${f.hash}`).join("\n")).digest("hex").slice(0, 16);
  const manifest: CatalogueManifest = {
    format: 1,
    revision,
    generatedAt: new Date().toISOString(),
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
  };
  writeFileSync(path.join(PUBLIC, "atlas", "manifest.json"), JSON.stringify(manifest));
  console.log(`catalogue manifest: ${files.length} files, ${(manifest.totalBytes / 1e6).toFixed(1)} MB, revision ${revision}`);
}

main();
