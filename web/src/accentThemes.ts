// driftmail — Akzentfarben-Themes
//
// Spiegelt contracts/design-tokens.json color.accentThemes 1:1 (Werte hier
// NICHT frei erfinden -- bei Änderungsbedarf zuerst die Contract-Datei
// anpassen). Kein Build-Time-Import der JSON-Datei aus web/ heraus (gleiches
// Prinzip wie tokens.css, das dieselben Werte separat als CSS Custom
// Properties führt), deshalb eine kleine, bewusst gehaltene Kopie hier.
//
// [2026-09-28] Redesign "ruhig & warm" + WEB_INBOX.md 27.09. "WAEHLBARE
// AKZENTFARBEN": fünf Themes statt sechs, Default "gruen". Jedes Theme hat
// ein hell- und ein dunkel-Set, weil ein einzelner Wert nicht in beiden
// Modi lesbar ist (Schwarz auf dunklem Grund, weiße Schrift auf hellem
// Gelb/Grün).
import type { AccentTheme } from "./types";

interface AccentModeValues {
  /** Logo, Zweig-Deko, Fokusring -- nicht für bedeutungstragende Elemente */
  brand: string;
  /** Buttons, Links, Ungelesen-Punkt, aktives Ordner-Icon */
  accent: string;
  /** Textfarbe auf `accent`-Flächen */
  onAccent: string;
  selectedBg: string;
  selectedText: string;
}

export interface AccentThemeDefinition {
  id: AccentTheme;
  label: string;
  light: AccentModeValues;
  dark: AccentModeValues;
}

export const ACCENT_THEMES: AccentThemeDefinition[] = [
  {
    id: "gruen",
    label: "Grün",
    light: { brand: "#3FA46A", accent: "#2A7D50", onAccent: "#FFFFFF", selectedBg: "#E7F3EC", selectedText: "#1E5A3B" },
    dark: { brand: "#5CC08A", accent: "#3FA46A", onAccent: "#0C1A11", selectedBg: "#1F2B1F", selectedText: "#BFE5CD" },
  },
  {
    id: "gelb",
    label: "Gelb",
    light: { brand: "#D9A441", accent: "#8A6415", onAccent: "#FFFFFF", selectedBg: "#FBF1DC", selectedText: "#6B4A0E" },
    dark: { brand: "#E6B85C", accent: "#D9A441", onAccent: "#1A1305", selectedBg: "#2E2512", selectedText: "#F0D59A" },
  },
  {
    id: "outlook_blue",
    label: "Blau",
    light: { brand: "#0078D4", accent: "#0067B8", onAccent: "#FFFFFF", selectedBg: "#DEECF9", selectedText: "#004578" },
    dark: { brand: "#4BA3E8", accent: "#3A93DA", onAccent: "#06121C", selectedBg: "#13283A", selectedText: "#B9DBF6" },
  },
  {
    id: "rosa",
    label: "Rosa",
    light: { brand: "#D9487A", accent: "#B8325F", onAccent: "#FFFFFF", selectedBg: "#FBE4EC", selectedText: "#7A1E40" },
    dark: { brand: "#EC7AA0", accent: "#E0628C", onAccent: "#1C0710", selectedBg: "#34161F", selectedText: "#F6C2D3" },
  },
  {
    id: "schwarz",
    label: "Schwarz",
    light: { brand: "#1F1F1F", accent: "#1F1F1F", onAccent: "#FFFFFF", selectedBg: "#E9E8E3", selectedText: "#1F1F1F" },
    dark: { brand: "#E6E6E0", accent: "#E6E6E0", onAccent: "#141414", selectedBg: "#2A2A28", selectedText: "#F0F0EA" },
  },
];

/** Setzt je Theme das hell- und das dunkel-Set als `--theme-*`-Variablen
 * inline auf <html>; tokens.css wählt daraus je nach Modus. Unbekannte
 * Werte (z.B. ein alter Wert aus einem Backend-Stand vor der Migration)
 * fallen auf Grün zurück, statt die Farben leer zu lassen. */
export function applyAccentTheme(theme: AccentTheme): void {
  const def = ACCENT_THEMES.find((t) => t.id === theme) ?? ACCENT_THEMES[0];
  const style = document.documentElement.style;
  for (const mode of ["light", "dark"] as const) {
    const v = def[mode];
    style.setProperty(`--theme-brand-${mode}`, v.brand);
    style.setProperty(`--theme-accent-${mode}`, v.accent);
    style.setProperty(`--theme-on-accent-${mode}`, v.onAccent);
    style.setProperty(`--theme-selected-bg-${mode}`, v.selectedBg);
    style.setProperty(`--theme-selected-text-${mode}`, v.selectedText);
  }
}
