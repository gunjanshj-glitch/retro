// Classifies a trip group into a small set of short, human-readable theme
// tags (shown as badges in the map tooltip) by scanning its tagline, offer
// summary, and highlight copy for keyword clusters. Purely heuristic — no
// schema change required, since every group already carries this free text.

import type { Group } from "@/content/schema";

type Theme = { label: string; keywords: RegExp };

const THEMES: Theme[] = [
  {
    label: "Pilgrimage",
    keywords: /\b(temple|shrine|pilgrim|dham|kailash|mosque|monastery|cathedral|basilica|sacred|ashram|ghat)\b/i,
  },
  {
    label: "Hill station",
    keywords: /\b(hill station|mountain|valley|peak|trek|himalaya|glacier|meadow|ridge|pass\b|alps|highland)\b/i,
  },
  {
    label: "Nature & wildlife",
    keywords: /\b(beach|backwater|coral|reef|island|waterfall|forest|wildlife|safari|lake|national park|jungle|lagoon|desert|savanna)\b/i,
  },
  {
    label: "Heritage & culture",
    keywords: /\b(heritage|fort|palace|museum|colonial|unesco|old town|market|ruins|archipelago)\b/i,
  },
];

export function classifyGroupThemes(group: Group): string[] {
  const text = [group.tagline, group.offer?.summary, ...(group.offer?.highlights ?? [])]
    .filter(Boolean)
    .join(" \n ");

  const matched = THEMES.filter((t) => t.keywords.test(text)).map((t) => t.label);
  return matched.slice(0, 2);
}
