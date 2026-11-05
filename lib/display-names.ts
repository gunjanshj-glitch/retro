/**
 * Spelling fixes for place and country names as travellers see them.
 *
 * The catalogue data now uses the standard spellings, but text saved before
 * the correction (trip requests, quote snapshots, cached catalogue files)
 * still carries the old ones ("Hungery", "Linchestine"). This keeps that
 * older text reading correctly, and shows "Czech" as "Czechia".
 */
const FIXES: Record<string, string> = {
  Hungery: "Hungary",
  Linchestine: "Liechtenstein",
  Kyrgisthan: "Kyrgyzstan",
  Phillipines: "Philippines",
  Seol: "Seoul",
  Masaimara: "Maasai Mara",
  Scandinivia: "Scandinavia",
  Czech: "Czechia",
};

export function displayName(name: string): string {
  return FIXES[name.trim()] ?? name;
}

// "Czech" stays as written inside sentences ("Czech Republic", "Czech cuisine");
// only the bare country name is renamed.
const IN_TEXT = Object.keys(FIXES).filter((k) => k !== "Czech");
const WORDS = new RegExp(`\\b(${IN_TEXT.join("|")})\\b`, "g");

/** The same fixes applied to whole words inside running text (taglines, place lists). */
export function fixSpelling(text: string): string {
  return text.replace(WORDS, (w) => FIXES[w] ?? w);
}
