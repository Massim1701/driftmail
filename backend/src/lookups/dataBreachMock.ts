// Mock-Implementierung von DataBreachLookup (siehe types.ts).
//
// WICHTIG: eine echte Implementierung würde einen Dienst wie
// haveibeenpwned.com abfragen -- deren API verlangt inzwischen einen
// kostenpflichtigen API-Key. Analog zur KI-Anbindungs-Entscheidung
// (TERMINAL_INBOX.md 21.09. KORREKTUR: kein driftmail-finanzierter
// Cloud-Key) will driftmail das nicht ungefragt für alle User
// vorfinanzieren -- ein BYOK-Modell passt hier aber auch nicht (Datenleck-
// Prüfung ist ein geteilter Bedrohungsdaten-Dienst, kein persönlicher
// KI-Zugang mit eigenen Nutzungskosten). Bewusst gemockt, bis eine externe
// Finanzierung/ein Anbieter geklärt ist -- siehe backend/README.md.
//
// Dieser Mock macht KEINEN Netzwerk-Call, sondern liefert für Adressen mit
// einem deterministischen Test-Auslöser ("leaktest"/"pwned" im lokalen Teil
// der Adresse) einen erfundenen Beispiel-Treffer -- analog zu den anderen
// Mocks in diesem Ordner (z.B. der Botnetz-Beispiel-IP-Liste in
// ipReputationMock.ts).

import type { DataBreachHit, DataBreachLookup } from "./types";

const TRIGGER_PATTERN = /leaktest|pwned/i;

export class MockDataBreachLookup implements DataBreachLookup {
  async check(emailAddress: string): Promise<DataBreachHit[]> {
    if (!TRIGGER_PATTERN.test(emailAddress)) return [];
    return [
      { breachName: "Beispiel-Datenleck 2024 (Demo-Dienst XY)", breachDate: "2024-03-11" },
      { breachName: "Beispiel-Datenleck 2026 (Demo-Forum ABC)", breachDate: "2026-01-22" },
    ];
  }
}
