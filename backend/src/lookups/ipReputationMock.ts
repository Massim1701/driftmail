// Mock-Implementierung von IpReputationLookup (siehe types.ts).
//
// WICHTIG: Eine echte Implementierung braucht einen Abgleich gegen einen
// DNSBL-Dienst (z.B. Spamhaus XBL/CBL) für die sendende IP. Dieser Mock
// macht KEINEN Netzwerk-Call, sondern vergleicht gegen eine frei erfundene
// Beispiel-Liste "bekannter" Botnetz-Adressbereiche -- NICHT echte
// Blocklist-Daten.

import type { IpReputationFlag, IpReputationLookup } from "./types";

const IPV4_REGEX = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;

/** Extrahiert die sendende IP aus den Mail-Headern, falls ermittelbar.
 * Prüft zuerst "X-Originating-IP" (falls gesetzt), sonst den "Received"-
 * Header (typisches Format: "from ... (... [1.2.3.4]) by ..."). Liefert
 * null, wenn keine IP gefunden wird -- die IP-Reputation liefert dann immer
 * "unknown", nie geraten (siehe ipReputationMock.ts-Kommentar). */
export function extractSendingIp(headers: Record<string, string> | null): string | null {
  if (!headers) return null;

  const originating = headers["X-Originating-IP"] ?? headers["x-originating-ip"];
  if (originating) {
    const match = originating.match(IPV4_REGEX);
    if (match) return match[1];
  }

  const received = headers["Received"] ?? headers["received"];
  if (received) {
    const match = received.match(IPV4_REGEX);
    if (match) return match[1];
  }

  return null;
}

// Frei erfundene Beispiel-"Blockliste" (Adressbereiche, die in der Praxis
// öfter mit Botnetz-/Malware-Hosting in Verbindung gebracht werden) -- rein
// zur Demonstration eines plausiblen Mock-Ergebnisses, KEINE echten
// Spamhaus-Daten.
const KNOWN_BOTNET_PREFIXES = ["185.220.", "45.155.", "194.61."];

export class MockIpReputationLookup implements IpReputationLookup {
  async lookup(ip: string | null): Promise<IpReputationFlag> {
    if (!ip) return "unknown"; // keine IP ermittelbar -> nie raten
    if (KNOWN_BOTNET_PREFIXES.some((prefix) => ip.startsWith(prefix))) return "known_botnet";
    return "clean";
  }
}
