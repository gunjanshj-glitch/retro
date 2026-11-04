/** Design tokens. One source for colour, spacing, radius and type (docs/mobile/03). Dark-first; light follows the system. */
import { useColorScheme } from "react-native";

const dark = {
  bg: "#0e1411",
  surface: "#161e19",
  surfaceHi: "#1e2823",
  border: "#2a3730",
  text: "#f2efe6",
  textDim: "#a4ada6",
  accent: "#c9a24a",
  onAccent: "#141006",
  success: "#5fbf8a",
  danger: "#e5736a",
  action: "#6fb1e6",
} as const;

const light: typeof dark extends infer T ? { [K in keyof T]: string } : never = {
  bg: "#f7f4ec",
  surface: "#ffffff",
  surfaceHi: "#efe9da",
  border: "#ded6c3",
  text: "#18201b",
  textDim: "#5b655e",
  accent: "#8a6a1d",
  onAccent: "#ffffff",
  success: "#1f7a4a",
  danger: "#b3392f",
  action: "#1f6fb0",
};

export type Palette = { [K in keyof typeof dark]: string };

export function useTheme(): Palette {
  return useColorScheme() === "light" ? light : dark;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const type = {
  title: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.4 },
  heading: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.8, textTransform: "uppercase" as const },
} as const;
