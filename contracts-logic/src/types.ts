// Track D — Typen, die 1:1 aus dem Track-0-Contract übernommen sind.
//
// WICHTIG: Quelle der Wahrheit ist contracts/ai-adapter-interface.ts und
// contracts/db-schema.sql im Repo-Root. Diese Datei dupliziert absichtlich
// nur die für Track D relevanten Typen, weil es (Stand jetzt) kein
// gemeinsames installierbares Package für contracts/ gibt, aus dem alle
// Tracks importieren könnten — siehe SYNC.md "Offene Fragen".
// Bei jeder Änderung an ai-adapter-interface.ts / db-schema.sql muss diese
// Datei manuell nachgezogen werden.

/** 1:1 aus contracts/ai-adapter-interface.ts */
export interface ContractData {
  providerName: string;
  contractStart: string | null; // ISO date (YYYY-MM-DD)
  contractEnd: string | null; // ISO date
  cancellationDeadline: string | null; // ISO date
  cancellationPeriodDays: number | null;
  extractedConfidence: number; // 0.0 - 1.0, niedrig -> User muss bestätigen
}

/**
 * Schwelle, ab der extractedConfidence als "niedrig" gilt und die UI
 * (nicht Teil von Track D) einen Review-Schritt anzeigen muss, statt den
 * Vertrag automatisch als "active" zu übernehmen.
 *
 * Nicht Teil des Track-0-Contracts (der legt nur das Feld fest, keinen
 * Schwellwert) — deshalb hier lokal definiert und in SYNC.md unter
 * "Offene Fragen" vermerkt, falls andere Tracks (v.a. C/iOS-UI, F/Web-UI)
 * denselben Schwellwert brauchen.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Row-Shape von contracts.status (contracts/db-schema.sql) */
export type ContractStatus = "active" | "cancelled" | "expired" | "needs_review";

/** Row-Shape der Tabelle `contracts` (contracts/db-schema.sql), camelCase. */
export interface ContractRow {
  id: string;
  userId: string;
  messageId: string;
  providerName: string;
  contractStart: string | null;
  contractEnd: string | null;
  cancellationDeadline: string | null;
  cancellationPeriodDays: number | null;
  status: ContractStatus;
  extractedConfidence: number | null;
}

/** Row-Shape der Tabelle `reminders` (contracts/db-schema.sql), camelCase. */
export interface ReminderRow {
  id: string;
  contractId: string;
  remindAt: string; // ISO datetime
  sent: boolean;
  snoozedUntil: string | null; // ISO datetime
}
