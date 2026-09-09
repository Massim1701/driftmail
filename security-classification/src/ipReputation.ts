/**
 * `ipReputationFlag` (Contract-Zusatz aus WEB_INBOX.md 08.09.,
 * "Botnetz-Erkennungssignale") braucht einen Abgleich der sendenden IP
 * gegen externe, botnetzspezifische Blocklisten (z.B. Spamhaus XBL/CBL --
 * anders als normale Spam-Listen, die auf Domain-Reputation zielen, zielen
 * diese auf "IP gehört zu einem kompromittierten Gerät"). Das ist ein
 * Netzwerk-Lookup gegen einen externen Dienst.
 *
 * Dieses Modul bekommt laut Auftrag NUR rawText+headers rein (kein
 * Netzwerk-/DB-Zugriff, siehe README.md dieses Pakets und
 * contracts/ai-adapter-interface.ts) -- es kann `ipReputationFlag` deshalb
 * grundsätzlich nicht ehrlich befüllen, selbst wenn die sendende IP aus
 * einem "Received"-Header extrahiert werden könnte (das reine Vorhandensein
 * einer IP sagt nichts über ihre Reputation aus, ohne den externen
 * Abgleich).
 *
 * Analog zur bestehenden Einschränkung bei `senderDomainAgeDays` /
 * `domainReputationScore` (siehe README.md "Bekannte Lücken" und SYNC.md
 * "Offene Fragen"): dieses Modul liefert IMMER `"unknown"`, nie `"clean"`
 * oder `"known_botnet"` -- alles andere wäre vorgetäuschte Sicherheit ohne
 * echten Abgleich. Ein Aufrufer mit Netzwerkzugriff (vermutlich Track A,
 * nach dem `analyzeMail()`-Aufruf, da das Backend Netzwerkzugriff hat)
 * müsste einen eigenen Blocklist-Lookup durchführen und das Feld selbst
 * nachträglich befüllen. Offene Frage dazu in SYNC.md "Offene Fragen".
 */
export function detectIpReputation(): "unknown" {
  return "unknown";
}
