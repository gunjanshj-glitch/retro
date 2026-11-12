/**
 * Add an attraction to an existing destination's markdown: § 14 block, § 15 code,
 * § 16 bullet and a § 27 cluster. The cluster is mandatory because it decides which
 * day the attraction is planned with; there is no default.
 *
 *   npm run new-attraction -- --place Dirang --name "Nag Temple" --cluster 4 \
 *     --text "Short description." [--tier optional|75|90] [--best-for "CULTURE"] [--price LOW]
 *   npm run new-attraction -- --place Dirang --name "X" --cluster new --duration "1 hour" --text "..."
 *
 * Add --dry to print the result without writing. Then run `npm run build-atlas`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "input_files/Destination Files markdown";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (n: string) => process.argv.includes(`--${n}`);
const die = (m: string): never => {
  console.error(m);
  process.exit(1);
};

function find(dir: string, base: string): string | null {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const r = find(p, base);
      if (r) return r;
    } else if (e.toLowerCase() === `${base.toLowerCase()}.md`) return p;
  }
  return null;
}

const place = arg("place") ?? die("--place is required");
const name = arg("name") ?? die("--name is required");
const text = arg("text") ?? die("--text (one descriptive paragraph) is required");
const file = find(ROOT, place) ?? die(`No markdown file named ${place}.md under ${ROOT}`);
let md = readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const code = `${place.toUpperCase().replace(/\s+/g, "_")}_A_${name.toUpperCase()}`;
if (md.includes(code)) die(`${name} already exists in ${file}`);

const sec = (n: number) => md.search(new RegExp(`^# ${n}\\.`, "m"));
for (const n of [14, 15, 16, 27, 28]) if (sec(n) < 0) die(`Section ${n} not found in ${file}`);

// 14: block just before "# 15."
const block =
  `## ${name.toUpperCase()}\n\n***best_for:*** ${arg("best-for") ?? "CULTURE · PHOTOGRAPHY"}\n\n` +
  `***price_level:*** ${arg("price") ?? "LOW"}\n\n***transport_convenience:*** 70\n\n${text}\n\n---\n\n`;
md = md.slice(0, sec(15)) + block + md.slice(sec(15));

// 15: code after the last existing code in the section
{
  const s = sec(15);
  const e = sec(16);
  const part = md.slice(s, e);
  const last = [...part.matchAll(/^[A-Z0-9_]+_A_.*$/gm)].pop();
  if (!last) die("No attraction codes found in section 15");
  const at = s + last!.index! + last![0].length;
  md = md.slice(0, at) + `\n\n${code}` + md.slice(at);
}

// 16: bullet under the chosen tier
{
  const tier = arg("tier") ?? "optional";
  const head = tier === "90" ? /Priority 90/i : tier === "75" ? /Priority 75/i : /Optional/i;
  const s = sec(16);
  const e = sec(17);
  const part = md.slice(s, e);
  const h = part.search(head);
  if (h < 0) die(`No "${tier}" tier heading in section 16`);
  const after = part.slice(h);
  const m = /\n\n(?=\*{3,5}|---|#)/.exec(after.slice(after.indexOf("\n")));
  const end = m ? after.indexOf("\n") + m.index : after.length;
  const at = s + h + end;
  md = md.slice(0, at) + `\n* ${name}` + md.slice(at);
}

// 27: cluster
const cl = arg("cluster") ?? die("--cluster <number|new> is required: it decides which day this is planned with");
{
  const s = sec(27);
  const clusters = [...md.slice(s, sec(28)).matchAll(/^## CLUSTER (\d+)\s*[—-]\s*(.*)$/gm)];
  if (cl === "new") {
    const next = Math.max(0, ...clusters.map((c) => Number(c[1]))) + 1;
    const dur = arg("duration") ?? die("--duration is required for a new cluster");
    const c =
      `## CLUSTER ${next} — ${name.toUpperCase()}\n\n*****attractions:*****\n\n* ${name}\n\n` +
      `*****recommended_duration:***** ${dur}\n\n*****walking_intensity:***** MEDIUM\n\n---\n\n`;
    const e = sec(28);
    md = md.slice(0, e) + c + md.slice(e);
  } else {
    const c = clusters.find((x) => x[1] === cl);
    if (!c) die(`No cluster ${cl}. Existing: ${clusters.map((x) => `${x[1]} ${x[2]}`).join("; ")}`);
    const from = s + c!.index!;
    const rest = md.slice(from);
    const am = /\*{3,5}attractions:\*{3,5}\n\n((?:\*[^\n]*\n)+)/.exec(rest);
    if (!am) die(`Cluster ${cl} has no attractions list`);
    const at = from + am!.index! + am![0].length;
    md = md.slice(0, at) + `* ${name}\n` + md.slice(at);
  }
}

if (flag("dry")) console.log(md.length, "bytes; code", code);
else {
  writeFileSync(file, md);
  console.log(`Added ${name} to ${file}. Now run: npm run build-atlas`);
}
