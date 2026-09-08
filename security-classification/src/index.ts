import { parseAuthHeaders } from "./authHeaders.js";
import { classify } from "./classification.js";
import { detectHomoglyphs } from "./homoglyph.js";
import { detectNewIban } from "./ibanDetection.js";
import { detectLinkMismatch } from "./linkMismatch.js";
import { detectSpamSubcategory } from "./spamSubcategory.js";
import type { SecurityResult } from "./types.js";
import { scoreUrgencyLanguage } from "./urgencyLanguage.js";

/**
 * Track B — Sicherheits-Klassifikation.
 *
 * Implementiert `AiAdapter.analyzeMail` aus contracts/ai-adapter-interface.ts
 * (Signatur identisch: rawText + headers rein, SecurityResult raus). Läuft
 * rein auf dem übergebenen Text/den Headern -- kein Netzwerk-, Backend-
 * oder DB-Zugriff, deshalb `async`/Promise nur der Interface-Kompatibilität
 * wegen (z.B. für spätere on-device-Modelle, die tatsächlich asynchron
 * sind); die aktuelle Implementierung ist synchron und deterministisch.
 *
 * Deckt NICHT ab (siehe README.md "Bekannte Lücken" für Details, warum):
 *  - senderDomainAgeDays / domainReputationScore: brauchen einen externen
 *    Dienst (WHOIS/Reputationsdatenbank), bleiben hier immer `null`.
 *  - "neu" bei containsNewIban: braucht Absender-Historie aus der DB,
 *    dieses Modul erkennt nur "IBAN in der Mail vorhanden" als Proxy.
 *  - urgencyLanguageScore & classification/confidenceScore: aktuell
 *    regelbasierte Platzhalter, kein echtes NLP/ML.
 *  - spamSubcategory: ebenfalls Keyword-Heuristik (siehe spamSubcategory.ts),
 *    bewusst konservativ kalibriert, weil "adult"/"gambling" im Aufrufer
 *    (Track A) sofortiges Löschen ohne Quarantäne auslösen.
 */
export async function analyzeMail(
  rawText: string,
  headers: Record<string, string>,
): Promise<SecurityResult> {
  const { spfStatus, dkimStatus, dmarcStatus } = parseAuthHeaders(headers);
  const homoglyphDetected = detectHomoglyphs(rawText, headers);
  const linkMismatchDetected = detectLinkMismatch(rawText);
  const urgencyLanguageScore = scoreUrgencyLanguage(rawText);
  const containsNewIban = detectNewIban(rawText);

  const { classification, confidenceScore } = classify({
    spfStatus,
    dkimStatus,
    dmarcStatus,
    homoglyphDetected,
    linkMismatchDetected,
    urgencyLanguageScore,
    containsNewIban,
  });

  // Hart aus dem Contract: NUR bei classification === "spam" gesetzt, sonst
  // immer null -- explizit auch bei "phishing" (siehe types.ts-Kommentar
  // und WEB_INBOX.md 08.09.).
  const spamSubcategory = classification === "spam" ? detectSpamSubcategory(rawText) : null;

  return {
    spfStatus,
    dkimStatus,
    dmarcStatus,
    senderDomainAgeDays: null,
    domainReputationScore: null,
    homoglyphDetected,
    linkMismatchDetected,
    urgencyLanguageScore,
    containsNewIban,
    classification,
    spamSubcategory,
    confidenceScore,
  };
}

export type { AuthStatus, Classification, SecurityResult, SpamSubcategory } from "./types.js";
export { parseAuthHeaders } from "./authHeaders.js";
export type { AuthHeaderResult } from "./authHeaders.js";
export { classify } from "./classification.js";
export type { ClassificationInput, ClassificationOutput } from "./classification.js";
export { CONFUSABLES, containsConfusableChar, detectHomoglyphs, extractDomains, isMixedScriptLabel } from "./homoglyph.js";
export { detectNewIban, extractIbans } from "./ibanDetection.js";
export { detectLinkMismatch, extractLinks } from "./linkMismatch.js";
export type { ExtractedLink } from "./linkMismatch.js";
export { detectSpamSubcategory } from "./spamSubcategory.js";
export { scoreUrgencyLanguage } from "./urgencyLanguage.js";
