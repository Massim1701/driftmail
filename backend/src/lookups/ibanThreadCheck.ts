// Implementierung von IbanThreadCheck (siehe types.ts) gegen den
// bestehenden Store -- WEB_INBOX.md 15.09., "IBAN-Wechsel im selben
// Thread". Reale Implementierung von Anfang an, kein Mock (arbeitet nur
// gegen die eigene DB, kein externer Dienst beteiligt).

import type { Store } from "../db/store";
import type { IbanThreadCheck } from "./types";
import { extractIbanCandidates } from "./ibanHistoryCheck";

// Sicherheitsgrenze gegen eine unerwartet lange/zyklische Thread-Kette
// (sollte bei sauberen UUID-FKs nie vorkommen, kostet aber nichts,
// abzusichern statt auf die Datenintegrität zu vertrauen).
const MAX_THREAD_DEPTH = 50;

export class StoreIbanThreadCheck implements IbanThreadCheck {
  constructor(private readonly store: Store) {}

  async checkChanged(inReplyToMessageId: string | null, ibans: string[]): Promise<boolean> {
    if (ibans.length === 0 || inReplyToMessageId === null) return false;
    const currentIbans = new Set(ibans);

    let cursor: string | null = inReplyToMessageId;
    const visited = new Set<string>();
    for (let depth = 0; cursor !== null && depth < MAX_THREAD_DEPTH; depth++) {
      if (visited.has(cursor)) break;
      visited.add(cursor);

      const ancestor = await this.store.getMessage(cursor);
      if (!ancestor) break; // Thread-Vorgaenger nicht (mehr) vorhanden -- z.B. per permanent delete entfernt.

      // Kein separat gespeicherter IBAN-Wert je Nachricht -- wird bei Bedarf
      // aus dem Body-Text re-extrahiert (gleiche einfache Regex-Kandidaten
      // wie ibanHistoryCheck.ts, kein Mod-97-Check noetig fuer diesen
      // Vergleich).
      for (const iban of extractIbanCandidates(ancestor.bodyText ?? "")) {
        if (!currentIbans.has(iban)) return true;
      }

      cursor = ancestor.inReplyToMessageId;
    }
    return false;
  }
}
