/**
 * The catalogue manifest: one small file the app fetches at every launch to learn whether the data
 * it holds is still current, and exactly which files to download if not.
 *
 * `revision` is derived from the file hashes, never typed by hand, so publishing new data changes it
 * automatically and no app release is ever needed for a price or content change.
 */
export type ManifestFile = {
  /** Path under the site root, e.g. `atlas/core.json`. */
  path: string;
  bytes: number;
  /** Hex SHA-256 of the file (first 32 characters). */
  hash: string;
};

export type CatalogueManifest = {
  /** Version of this manifest format, so a future shape can be told apart. */
  format: 1;
  revision: string;
  generatedAt: string;
  totalBytes: number;
  files: ManifestFile[];
};

export type SyncPlan = {
  /** True when nothing needs downloading. */
  upToDate: boolean;
  download: ManifestFile[];
  /** Local paths the new revision no longer has. */
  remove: string[];
  downloadBytes: number;
};

/** Which files to fetch (new or changed) and which to drop, given what the phone already holds. */
export function planSync(remote: CatalogueManifest, local: CatalogueManifest | null): SyncPlan {
  const have = new Map((local?.files ?? []).map((f) => [f.path, f.hash]));
  const download = remote.files.filter((f) => have.get(f.path) !== f.hash);
  const wanted = new Set(remote.files.map((f) => f.path));
  const remove = [...have.keys()].filter((p) => !wanted.has(p));
  return {
    upToDate: download.length === 0 && remove.length === 0 && local?.revision === remote.revision,
    download,
    remove,
    downloadBytes: download.reduce((n, f) => n + f.bytes, 0),
  };
}

/** Rejects anything that is not a well-formed manifest, so a broken response never replaces good data. */
export function parseManifest(value: unknown): CatalogueManifest | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<CatalogueManifest>;
  if (m.format !== 1 || typeof m.revision !== "string" || !m.revision || !Array.isArray(m.files)) return null;
  const files: ManifestFile[] = [];
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || typeof f.hash !== "string" || typeof f.bytes !== "number") return null;
    // Paths come from the network and become file names: refuse anything that could leave the data folder.
    if (f.path.startsWith("/") || f.path.split("/").some((seg) => seg === ".." || seg === "" || seg === ".")) return null;
    files.push({ path: f.path, hash: f.hash, bytes: f.bytes });
  }
  return {
    format: 1,
    revision: m.revision,
    generatedAt: typeof m.generatedAt === "string" ? m.generatedAt : "",
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
  };
}

/** Deep-assigns `source` into `target` in place, so an already-imported JSON object takes new values. */
export function overwriteInPlace(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      overwriteInPlace(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}
