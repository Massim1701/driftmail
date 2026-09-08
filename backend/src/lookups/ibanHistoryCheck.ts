// Implementierung von IbanHistoryCheck (siehe types.ts) gegen den
// bestehenden In-Memory-Store (src/db/store.ts, ibanHistory).
//
// Kein externer Netzwerk-Call nötig -- das ist bereits die "echte" Prüfung
// gegen die eigene DB (hier: In-Memory statt Postgres, siehe store.ts-
// Kopfkommentar "Annahmen"). "neu" heißt laut Web-Antwort (SYNC.md 08.09.):
// noch nie zuvor von diesem Absender an diesen User gesehen.

import type { Store } from "../db/store";
import type { IbanHistoryCheck } from "./types";

// Simple Regex-Kandidaten, KEINE Prüfsumme (kein Mod-97) -- bewusst
// dasselbe, einfache Grundprinzip wie src/ai/draftPhishingCheckMock.ts
// (dortiger Kommentar gilt hier genauso: mehr false positives/negatives als
// Track B's validierte Erkennung, für den Zweck dieses Postprocessing-
// Schritts aber ausreichend, echte IBAN-Extraktion wäre Sache von Track B).
const IBAN_REGEX = /\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{1,4}){2,7}\b/g;

/** Extrahiert IBAN-Kandidaten aus einem Text, normalisiert (Leerzeichen
 * entfernt, dedupliziert). Kein Mod-97-Check -- siehe Kommentar oben. */
export function extractIbanCandidates(text: string): string[] {
  const matches = text.toUpperCase().match(IBAN_REGEX);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.replace(/\s+/g, ""))));
}

export class StoreIbanHistoryCheck implements IbanHistoryCheck {
  constructor(private readonly store: Store) {}

  async checkAndRecord(userId: string, senderAddress: string, ibans: string[]): Promise<boolean> {
    if (ibans.length === 0) return false;

    let foundNew = false;
    for (const iban of ibans) {
      if (!this.store.hasSeenIban(userId, senderAddress, iban)) foundNew = true;
      // IBAN merken, unabhängig davon ob neu oder nicht -- damit ein
      // wiederholtes Vorkommen beim nächsten Aufruf korrekt als "nicht neu"
      // erkannt wird.
      this.store.recordIban(userId, senderAddress, iban);
    }
    return foundNew;
  }
}
