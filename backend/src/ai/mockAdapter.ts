// Mock-Implementierung von AiAdapter (contracts/ai-adapter-interface.ts).
//
// integration (09.09.): analyzeMail() ruft jetzt die ECHTE Track-B-Logik
// auf (@driftmail/security-classification, siehe package.json --
// file:-Dependency auf ../security-classification, verdrahtet in
// WEB_INBOX.md "Track A + Track B Integration"). Die restlichen drei
// Methoden (extractContract/summarize/draftReply) sind weiterhin Mock --
// Track D/E bauen die jeweils echte Logik, das ist eine separate,
// noch offene Integration.
//
// source ist hier immer "cloud_fallback", weil der Adapter serverseitig
// läuft (kein On-Device-Pfad im Backend). Die On-Device-Variante bauen die
// Plattform-Tracks (iOS etc.) nativ gegen dasselbe Interface.

import { analyzeMail as trackBAnalyzeMail } from "@driftmail/security-classification";
import type { AiAdapter, ContractData, MailSummary, MailThread, SecurityResult } from "./types";

const PHISHING_KEYWORDS = ["passwort bestätigen", "konto gesperrt", "klicken sie sofort", "iban geändert", "verifizieren sie jetzt"];
const CONTRACT_KEYWORDS = ["vertrag", "abonnement", "kündigungsfrist", "laufzeit", "vertragsende"];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

export class MockAiAdapter implements AiAdapter {
  async analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult> {
    // Track B liefert senderDomainAgeDays/domainReputationScore immer als
    // `null` (braucht externen WHOIS/Reputationsdienst, siehe
    // security-classification/README.md) -- die vier externen Lookups
    // (domain-/ip-Reputation, IBAN-/Empfänger-Historie) befüllen das als
    // eigener Nachbearbeitungsschritt in src/mail/sync.ts, unverändert
    // durch diese Integration.
    return trackBAnalyzeMail(rawText, headers);
  }

  async extractContract(rawText: string): Promise<ContractData | null> {
    if (!containsAny(rawText, CONTRACT_KEYWORDS)) return null;

    // Beispieldaten — keine echte Extraktion.
    const today = new Date();
    const contractEnd = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    const cancellationDeadline = new Date(contractEnd);
    cancellationDeadline.setDate(cancellationDeadline.getDate() - 30);

    return {
      providerName: "Beispiel GmbH",
      contractStart: today.toISOString().slice(0, 10),
      contractEnd: contractEnd.toISOString().slice(0, 10),
      cancellationDeadline: cancellationDeadline.toISOString().slice(0, 10),
      cancellationPeriodDays: 30,
      extractedConfidence: 0.55, // absichtlich niedrig -> UI zeigt Review-Schritt
    };
  }

  async summarize(rawText: string): Promise<MailSummary> {
    const actionRequired = containsAny(rawText, [...PHISHING_KEYWORDS, ...CONTRACT_KEYWORDS, "bitte antworten", "frist"]);
    const snippet = rawText.trim().replace(/\s+/g, " ").slice(0, 140);

    return {
      summaryText: snippet.length > 0 ? `Zusammenfassung (Mock): ${snippet}${rawText.length > 140 ? "…" : ""}` : "Kein Inhalt zum Zusammenfassen.",
      actionRequired,
      actionDescription: actionRequired ? "Mail prüfen und ggf. reagieren (Mock-Vorschlag)." : null,
      deadline: actionRequired ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10) : null,
    };
  }

  async draftReply(thread: MailThread): Promise<string> {
    const last = thread.messages[thread.messages.length - 1];
    const to = last?.fromAddress ?? "Absender";
    return (
      `Hallo,\n\n` +
      `vielen Dank für Ihre Nachricht${last?.subject ? ` "${last.subject}"` : ""}.\n` +
      `[Mock-Antwortentwurf — von Track B/D/E mit echter KI-Logik zu ersetzen]\n\n` +
      `Viele Grüße`
    );
  }
}
