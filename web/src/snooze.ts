// [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze") --
// ein paar sinnvolle Presets statt ausschließlich freier Datumsauswahl,
// analog zu Gmail/Superhuman. [2026-09-28] aus MessageDetailPane.tsx
// hierher gezogen, weil die Befehlspalette (CommandPalette.tsx) dieselben
// Presets anbietet.
export type SnoozePreset = "1h" | "tomorrow" | "nextWeek";

export const SNOOZE_PRESET_LABELS: Record<SnoozePreset, string> = {
  "1h": "In 1 Stunde",
  tomorrow: "Morgen früh",
  nextWeek: "Nächste Woche",
};

export function snoozePresetDate(preset: SnoozePreset): string {
  const now = new Date();
  if (preset === "1h") return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const d = new Date(now);
  d.setDate(d.getDate() + (preset === "tomorrow" ? 1 : 7));
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}
