// driftmail — Akzentfarben-Themes
//
// Spiegelt contracts/design-tokens.json color.accentThemes 1:1 (Werte hier
// NICHT frei erfinden -- bei Änderungsbedarf zuerst die Contract-Datei
// anpassen). Kein Build-Time-Import der JSON-Datei aus web/ heraus (gleiches
// Prinzip wie tokens.css, das dieselben Werte separat als CSS Custom
// Properties führt), deshalb eine kleine, bewusst gehaltene Kopie hier.
import type { AccentTheme } from "./types";

export interface AccentThemeDefinition {
  id: AccentTheme;
  label: string;
  accent: string;
  /** Nur bei "ocean_verlauf" gesetzt -- [from, to] für eine CSS-Gradient-
   * Vorschau. Siehe applyAccentTheme()-Kommentar für die bewusste Grenze,
   * warum --color-accent selbst trotzdem nur die erste Farbe bekommt. */
  gradient?: [string, string];
}

export const ACCENT_THEMES: AccentThemeDefinition[] = [
  { id: "teal", label: "Teal", accent: "#1D9E75" },
  { id: "ocean_blue", label: "Ocean Blue", accent: "#378ADD" },
  { id: "violett", label: "Violett", accent: "#7F77DD" },
  { id: "koralle", label: "Koralle", accent: "#D85A30" },
  { id: "ocean_verlauf", label: "Ocean-Verlauf", accent: "#378ADD", gradient: ["#378ADD", "#1D9E75"] },
];

/** Setzt `--color-accent` (tokens.css) live auf die gewählte Akzentfarbe --
 * inline auf <html>, überschreibt damit zuverlässig den in tokens.css
 * gesetzten Default, unabhängig von Light/Dark-Theme (dort wird
 * --color-accent nirgends neu gesetzt, bleibt also plattformweit konstant).
 *
 * Bewusste Grenze bei "ocean_verlauf": --color-accent selbst bekommt nur
 * die ERSTE Gradient-Farbe (#378ADD), keinen echten CSS-Gradient-String --
 * die bestehenden Verwendungen (Buttons, aktive Zeile, `color-mix(...,
 * var(--color-accent), ...)` für Hover-Zustände, Textfarbe bei Links) sind
 * alle auf einen einzelnen Farbwert ausgelegt; ein Gradient-String würde bei
 * `color`/`border-color`/`color-mix()` still verworfen bzw. ungültig. Eine
 * echte Gradient-Anwendung im UI wäre ein eigener, groesserer Schritt (z.B.
 * nur für bestimmte Flächen wie den "Neue Nachricht"-Button) -- hier bewusst
 * nicht mitgebaut, nur in der Theme-Auswahl selbst sichtbar (Swatch-Vorschau
 * nutzt den echten Gradient über `gradient` oben).
 */
export function applyAccentTheme(theme: AccentTheme): void {
  const def = ACCENT_THEMES.find((t) => t.id === theme);
  if (!def) return;
  document.documentElement.style.setProperty("--color-accent", def.accent);
}
