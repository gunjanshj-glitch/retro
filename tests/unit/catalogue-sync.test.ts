import { describe, expect, it } from "vitest";
import { overwriteInPlace, parseManifest, planSync, type CatalogueManifest } from "@retro/core/catalogue";

const m = (revision: string, files: [string, string][]): CatalogueManifest => ({
  format: 1, revision, generatedAt: "", totalBytes: files.length * 10,
  files: files.map(([path, hash]) => ({ path, hash, bytes: 10 })),
});

describe("planSync", () => {
  it("downloads everything on first launch", () => {
    const plan = planSync(m("r1", [["atlas/a.json", "h1"], ["atlas/b.json", "h2"]]), null);
    expect(plan.upToDate).toBe(false);
    expect(plan.download).toHaveLength(2);
    expect(plan.downloadBytes).toBe(20);
  });
  it("does nothing when the revision matches", () => {
    const x = m("r1", [["atlas/a.json", "h1"]]);
    expect(planSync(x, x)).toMatchObject({ upToDate: true, download: [], remove: [] });
  });
  it("fetches only changed and new files, and drops removed ones", () => {
    const local = m("r1", [["a", "1"], ["b", "2"], ["gone", "3"]]);
    const remote = m("r2", [["a", "1"], ["b", "CHANGED"], ["new", "4"]]);
    const plan = planSync(remote, local);
    expect(plan.download.map((f) => f.path)).toEqual(["b", "new"]);
    expect(plan.remove).toEqual(["gone"]);
    expect(plan.upToDate).toBe(false);
  });
});

describe("parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest(m("r1", [["atlas/a.json", "h"]]))?.files).toHaveLength(1);
  });
  it.each([null, "x", {}, { format: 2, revision: "r", files: [] }, { format: 1, revision: "", files: [] }, { format: 1, revision: "r", files: "no" }])("rejects %j", (bad) => {
    expect(parseManifest(bad)).toBeNull();
  });
  it("refuses paths that could leave the data folder", () => {
    for (const path of ["../evil", "/abs", "a//b", "a/../b", "./a"]) {
      expect(parseManifest({ format: 1, revision: "r", files: [{ path, hash: "h", bytes: 1 }] })).toBeNull();
    }
  });
});

describe("overwriteInPlace", () => {
  it("updates nested values on the same object, adds and removes keys", () => {
    const target: Record<string, unknown> = { a: 1, nested: { x: 1, y: 2 }, list: [1], gone: true };
    const ref = target.nested;
    overwriteInPlace(target, { a: 2, nested: { x: 9, z: 3 }, list: [7, 8] });
    expect(target).toEqual({ a: 2, nested: { x: 9, z: 3 }, list: [7, 8] });
    expect(target.nested).toBe(ref);
  });
});
