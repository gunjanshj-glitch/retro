import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `@retro/core` runs in the browser, the Cloudflare Worker and (soon) React Native. Anything that
 * only exists in one of them must stay out, or the mobile app will fail at runtime on a phone, long
 * after every web test passed. This is the cheap way to find out at commit time.
 */
const pkg = path.join(process.cwd(), "packages/core");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules") return [];
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const sources = files(pkg).map((f) => ({ file: path.relative(pkg, f), text: readFileSync(f, "utf8") }));
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Module specifiers from real import/export statements and dynamic imports, not from prose or strings. */
const specifiers = (text: string) => {
  const src = stripComments(text);
  return [
    ...[...src.matchAll(/^\s*(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
};

describe("@retro/core stays portable", () => {
  it("has sources to check", () => expect(sources.length).toBeGreaterThan(10));

  it("imports only relative files, zod, and the repo's content/ JSON", () => {
    const bad: string[] = [];
    for (const { file, text } of sources) {
      for (const spec of specifiers(text)) {
        const ok = spec === "zod" || (spec.startsWith(".") && (!spec.includes("../content/") || spec.endsWith(".json")));
        // a relative import must not climb out of the package except to reach content/*.json
        const climbs = spec.startsWith("../") && !spec.endsWith(".json") && path.resolve(path.dirname(path.join(pkg, file)), spec).indexOf(pkg) !== 0;
        if (!ok || climbs) bad.push(`${file}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("touches no browser or Node globals", () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const globals = /\b(?:window|document|localStorage|sessionStorage|navigator)\s*[.[]|\bprocess\.env\b|\brequire\s*\(/;
    expect(sources.filter(({ text }) => globals.test(strip(text))).map((s) => s.file)).toEqual([]);
  });

  it("declares no 'use client' (it is not a Next.js component)", () => {
    expect(sources.filter(({ text }) => /^\s*["']use client["']/.test(text)).map((s) => s.file)).toEqual([]);
  });
});
