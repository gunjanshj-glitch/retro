/**
 * Spelling fixes for place and country names as travellers see them.
 *
 * The catalogue spells a few names differently from their usual English form
 * ("Hungery", "Linchestine"). Those spellings are also lookup keys in the ETL
 * and pricing data, so they are corrected here, at display time only, rather
 * than in the data.
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
