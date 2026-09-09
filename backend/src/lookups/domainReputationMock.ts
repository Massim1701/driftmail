// Mock-Implementierung von DomainReputationLookup (siehe types.ts).
//
// WICHTIG: Eine echte Implementierung braucht eine WHOIS-Abfrage (Domain-
// Alter) plus einen Reputationsdienst (z.B. Google Safe Browsing, ein
// kommerzieller Domain-Reputationsdienst). Dieser Mock macht KEINEN
// Netzwerk-Call, sondern liefert plausible, deterministische Beispieldaten
// über simple Heuristiken auf dem Domain-String selbst (verdächtige TLDs/
// Schlüsselwörter -> "junge, schlecht bewertete Domain"), analog zu den
// Keyword-Heuristiken in src/ai/mockAdapter.ts.

import type { DomainReputationLookup, DomainReputationResult } from "./types";
import { stableHash } from "./util";

// Freihändig gewählte Beispiel-TLDs/Schlüsselwörter, die in echten
// Phishing-Kampagnen überdurchschnittlich oft auftauchen (kein echter
// Datensatz, nur eine plausible Beispiel-Heuristik für diesen Mock).
const SUSPICIOUS_TLDS = ["tk", "ru", "top", "xyz", "click", "work", "zip", "info"];
const SUSPICIOUS_KEYWORDS = ["secure", "login", "verify", "sicherheit", "konto-check", "bonus", "casino", "account"];

function looksSuspicious(domain: string): boolean {
  const tld = domain.split(".").pop() ?? "";
  return SUSPICIOUS_TLDS.includes(tld) || SUSPICIOUS_KEYWORDS.some((k) => domain.includes(k));
}

export class MockDomainReputationLookup implements DomainReputationLookup {
  async lookup(domain: string): Promise<DomainReputationResult> {
    const lower = domain.toLowerCase();
    const hash = stableHash(lower);

    if (looksSuspicious(lower)) {
      // Junge Domain (Tage statt Jahre), niedrige Reputation -- typisches
      // Muster einer frisch registrierten Phishing-/Wegwerf-Domain.
      return {
        senderDomainAgeDays: 3 + (hash % 90), // 3–92 Tage
        domainReputationScore: Math.round((hash % 25)) / 100, // 0.00–0.24
      };
    }

    // Etablierte Domain: mehrere Jahre alt, hohe Reputation.
    return {
      senderDomainAgeDays: 400 + (hash % 3000), // ca. 1–9 Jahre
      domainReputationScore: Math.round(70 + (hash % 30)) / 100, // 0.70–0.99
    };
  }
}
