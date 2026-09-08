// Mock-Implementierung von AiAdapter (contracts/ai-adapter-interface.ts).
//
// WICHTIG: Die echte KI-Klassifikations-/Extraktions-Logik baut Track B
// (Sicherheits-Klassifikation) bzw. Track D (Vertrag & Reminder). Dieser
// Adapter liefert plausible Beispieldaten mit ein paar simplen
// Keyword-Heuristiken, NICHT echte KI-Analyse. Er erfüllt nur die
// Interface-Form, damit Track A end-to-end testbar ist.
//
// source ist hier immer "cloud_fallback", weil der Adapter serverseitig
// läuft (kein On-Device-Pfad im Backend). Die On-Device-Variante bauen die
// Plattform-Tracks (iOS etc.) nativ gegen dasselbe Interface.

import type { AiAdapter, ContractData, MailSummary, MailThread, SecurityResult } from "./types";

const PHISHING_KEYWORDS = ["passwort bestätigen", "konto gesperrt", "klicken sie sofort", "iban geändert", "verifizieren sie jetzt"];
const SPAM_KEYWORDS = ["gewinnspiel", "gratis", "jetzt kaufen", "einmalige chance", "% rabatt"];
const CONTRACT_KEYWORDS = ["vertrag", "abonnement", "kündigungsfrist", "laufzeit", "vertragsende"];

// Spam-Unterkategorie (WEB_INBOX.md 08.09., siehe SYNC.md): "adult"/"gambling"
// loesen in der Sync-Pipeline sofortiges Loeschen aus, "generic"/"marketing"
// verhalten sich wie bisheriger Spam. Simple Keyword-Heuristik, NICHT echte
// Klassifikation -- Track B ersetzt das (siehe README "Was ist echt/Mock").
const ADULT_KEYWORDS = ["xxx video", "erotik-cam", "live sex chat"];
const GAMBLING_KEYWORDS = ["casino", "jackpot", "sportwetten", "spielautomaten"];
const MARKETING_KEYWORDS = ["% rabatt", "jetzt kaufen"];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function resolveSpamSubcategory(rawText: string): SecurityResult["spamSubcategory"] {
  if (containsAny(rawText, ADULT_KEYWORDS)) return "adult";
  if (containsAny(rawText, GAMBLING_KEYWORDS)) return "gambling";
  if (containsAny(rawText, MARKETING_KEYWORDS)) return "marketing";
  return "generic";
}

export class MockAiAdapter implements AiAdapter {
  async analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult> {
    const looksPhishing = containsAny(rawText, PHISHING_KEYWORDS);
    const looksSpam = !looksPhishing && containsAny(rawText, SPAM_KEYWORDS);
    const classification: SecurityResult["classification"] = looksPhishing
      ? "phishing"
      : looksSpam
      ? "spam"
      : "safe";

    const spf = (headers["Received-SPF"] ?? headers["received-spf"] ?? "").toLowerCase();

    return {
      spfStatus: spf.includes("fail") ? "fail" : spf.includes("pass") ? "pass" : "none",
      dkimStatus: "none",
      dmarcStatus: "none",
      senderDomainAgeDays: looksPhishing ? 12 : 1460,
      domainReputationScore: looksPhishing ? 0.12 : looksSpam ? 0.4 : 0.92,
      homoglyphDetected: false,
      linkMismatchDetected: looksPhishing,
      urgencyLanguageScore: looksPhishing ? 0.85 : looksSpam ? 0.5 : 0.05,
      containsNewIban: rawText.toLowerCase().includes("iban"),
      classification,
      spamSubcategory: looksSpam ? resolveSpamSubcategory(rawText) : null,
      confidenceScore: looksPhishing ? 0.88 : looksSpam ? 0.7 : 0.95,
    };
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
