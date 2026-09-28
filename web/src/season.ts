// driftmail — Jahreszeit für den saisonalen Zweig
//
// [2026-09-28] Zeiträume 1:1 aus contracts/design-tokens.json
// "seasonalTwig.seasons" (lokales Datum, Grenzen inklusive). Getrennt von
// seasonalTwig.tsx, damit jene Datei nur Komponenten exportiert.

export type Season = "fruehling" | "sommer" | "herbst" | "weihnachten" | "winter";

export function seasonFor(date: Date): Season {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m >= 3 && m <= 5) return "fruehling";
  if (m >= 6 && m <= 8) return "sommer";
  if (m >= 9 && m <= 11) return "herbst";
  if (m === 12 && d <= 26) return "weihnachten";
  return "winter";
}

export const SEASON_EMPTY_LINE: Record<Season, string> = {
  fruehling: "Draußen blüht es gerade.",
  sommer: "Ab in die Sonne.",
  herbst: "Zeit für einen Tee.",
  weihnachten: "Schöne Feiertage.",
  winter: "Bleib schön warm.",
};
