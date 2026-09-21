// Vertraulicher Modus (WEB_INBOX.md 21.09. "DREI WEITERE FEATURES -
// Gmail-Recherche" Punkt 3). Kein Hintergrund-Job (siehe backend/README.md
// "Annahmen" -- gleiche bewusste Grenze wie ueberall sonst in diesem
// Projekt): der Ablauf wird stattdessen lazy beim naechsten Lesezugriff
// (store.getMessage()/listMessages()) geprueft. Reine, seiteneffektfreie
// Entscheidungsfunktion hier -- das tatsaechliche Loeschen (bodyText ->
// NULL, EINMALIG persistiert) passiert in db/store.ts bzw.
// db/postgresStore.ts, da nur dort die jeweilige Persistenzschicht bekannt
// ist.

import type { MessageRecord } from "../types";

export function isConfidentialExpired(m: Pick<MessageRecord, "confidentialUntil" | "bodyText">): boolean {
  return m.confidentialUntil !== null && m.bodyText !== null && new Date(m.confidentialUntil).getTime() <= Date.now();
}
