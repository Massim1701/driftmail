// Implementierung von RecipientReputationLookup (siehe types.ts) gegen den
// bestehenden In-Memory-Store.
//
// "fraud_alerts" (db-schema.sql) ist an messages, nicht an Empfänger-
// Adressen geknüpft (siehe backend/README.md, bisherige Grenze). Statt eine
// zusätzliche, im Contract nicht vorgesehene Tabelle zu erfinden, nutzt
// dieser Mock zwei bereits vorhandene, plausible Signale aus dem Store:
//   1. "safe": der User hat dieser Adresse laut `outgoing_send_log` schon
//      einmal erfolgreich geschrieben (bekannter, unauffälliger Kontakt).
//   2. "flagged": diese Adresse (oder ihre Domain) ist bereits als Absender
//      einer eingehenden, als "phishing" klassifizierten Mail aufgefallen
//      (`messages` + `message_security`) -- das mock-äquivalente Signal zu
//      einem echten fraud_alerts-Join.
//   3. sonst "unknown" (keine Historie).
// Eine echte Implementierung würde stattdessen `fraud_alerts` +
// `domain_reputation_score` gegen die Empfänger-Adresse abfragen (siehe
// WEB_INBOX.md 08.09.).

import type { Store } from "../db/store";
import type { RecipientReputation, RecipientReputationLookup } from "./types";
import { domainFromAddress } from "./util";

export class MockRecipientReputationLookup implements RecipientReputationLookup {
  constructor(private readonly store: Store) {}

  async lookup(userId: string, recipientAddress: string | null): Promise<RecipientReputation> {
    if (!recipientAddress) return "unknown";
    const normalized = recipientAddress.trim().toLowerCase();
    if (!normalized) return "unknown";

    if (this.store.hasSentTo(userId, normalized)) return "safe";

    const domain = domainFromAddress(normalized);
    const matchesPhishingSender = this.store.messages.some((m) => {
      const fromLower = m.fromAddress.toLowerCase();
      const sameAddress = fromLower === normalized;
      const sameDomain = domain !== null && domainFromAddress(fromLower) === domain;
      if (!sameAddress && !sameDomain) return false;
      const security = this.store.getMessageSecurity(m.id);
      return security?.classification === "phishing";
    });
    if (matchesPhishingSender) return "flagged";

    return "unknown";
  }
}
