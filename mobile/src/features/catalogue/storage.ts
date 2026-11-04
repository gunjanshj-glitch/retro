/**
 * On-device copy of the catalogue (places, prices, routes, maps).
 *
 * Each revision lives in its own folder and `current.json` points at one of them. A new revision is built
 * completely (unchanged files copied, changed files downloaded) before the pointer moves, so a dropped
 * connection or a killed app can never leave the phone with half old, half new data.
 */
import { Directory, File, Paths } from "expo-file-system";
import { parseManifest, planSync, type CatalogueManifest, type ManifestFile } from "@retro/core/catalogue";
import { SITE_URL } from "@/lib/env";

const root = () => new Directory(Paths.document, "catalogue");
const pointer = () => new File(root(), "current.json");
const revDir = (revision: string) => new Directory(root(), `r-${revision.replace(/[^a-z0-9]/gi, "")}`);

export type Local = { manifest: CatalogueManifest; dir: Directory };

export function readLocal(): Local | null {
  try {
    if (!pointer().exists) return null;
    const manifest = parseManifest(JSON.parse(pointer().textSync()));
    if (!manifest) return null;
    const dir = revDir(manifest.revision);
    return dir.exists ? { manifest, dir } : null;
  } catch {
    return null;
  }
}

export class SyncError extends Error {}

/** The small "what is current?" file. A short timeout: this runs on every launch and must never hang the app. */
export async function fetchRemoteManifest(timeoutMs = 6000): Promise<CatalogueManifest> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SITE_URL}/atlas/manifest.json?t=${Date.now()}`, { signal: ctl.signal, headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) throw new SyncError(`manifest ${res.status}`);
    const manifest = parseManifest(await res.json());
    if (!manifest) throw new SyncError("manifest malformed");
    return manifest;
  } finally {
    clearTimeout(timer);
  }
}

export type Progress = { files: number; filesTotal: number; bytes: number; bytesTotal: number };

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

/** Brings the phone to `remote`. Throws, leaving the previous revision untouched, if anything fails. */
export async function syncTo(remote: CatalogueManifest, local: Local | null, onProgress: (p: Progress) => void): Promise<Local> {
  const plan = planSync(remote, local?.manifest ?? null);
  const dir = revDir(remote.revision);
  try {
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true });

    const keep = remote.files.filter((f) => !plan.download.includes(f));
    for (const f of keep) {
      const from = new File(local!.dir, f.path);
      const to = new File(dir, f.path);
      new Directory(to.parentDirectory.uri).create({ intermediates: true, idempotent: true });
      await from.copy(to);
    }

    const progress: Progress = { files: 0, filesTotal: plan.download.length, bytes: 0, bytesTotal: plan.downloadBytes };
    const fetchOne = async (f: ManifestFile) => {
      const res = await fetch(`${SITE_URL}/${f.path}?v=${f.hash}`);
      if (!res.ok) throw new SyncError(`${f.path} ${res.status}`);
      const text = await res.text();
      const to = new File(dir, f.path);
      new Directory(to.parentDirectory.uri).create({ intermediates: true, idempotent: true });
      to.create({ overwrite: true });
      await to.write(text);
      progress.files += 1;
      progress.bytes += f.bytes;
      onProgress({ ...progress });
    };
    onProgress({ ...progress });
    await pool(plan.download, 8, fetchOne);

    // Only now does the new revision become current.
    pointer().create({ intermediates: true, overwrite: true });
    await pointer().write(JSON.stringify(remote));
    if (local && local.dir.uri !== dir.uri) {
      try { local.dir.delete(); } catch { /* an old folder that will not delete is only wasted space */ }
    }
    return { manifest: remote, dir };
  } catch (error) {
    try { if (dir.exists) dir.delete(); } catch { /* best effort */ }
    throw error;
  }
}

export function readText(local: Local, path: string): string {
  return new File(local.dir, path).textSync();
}

export function readJson<T>(local: Local, path: string): T {
  return JSON.parse(readText(local, path)) as T;
}

export function exists(local: Local, path: string): boolean {
  return new File(local.dir, path).exists;
}
