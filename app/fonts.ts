import { Instrument_Serif, Figtree } from "next/font/google";

// Display: Instrument Serif, a condensed editorial serif (single 400 weight,
// roman + italic), for headlines. Interface: Figtree, a friendly geometric sans
// for everything else. Exposed as CSS variables; `app/globals.css` builds
// --font-display and --font-interface (with fallback stacks) from them.
export const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const interface_ = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});
