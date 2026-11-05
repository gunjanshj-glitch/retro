import { Fraunces, Figtree } from "next/font/google";

// Display: Fraunces, a soft "old-style" serif with optical sizing, for
// headings. Interface: Figtree, a friendly geometric sans for everything else.
// Exposed as CSS variables; `app/globals.css` builds --font-display and
// --font-interface (with fallback stacks) from them.
export const display = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
});

export const interface_ = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});
