import { parseAuthHeaders } from "./authHeaders.js";
import { classify } from "./classification.js";
import { detectHomoglyphs } from "./homoglyph.js";
import { detectNewIban } from "./ibanDetection.js";
import { detectLinkMismatch } from "./linkMismatch.js";
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
    confidenceScore,
  };
}

export type { AuthStatus, Classification, SecurityResult } from "./types.js";
export { parseAuthHeaders } from "./authHeaders.js";
export type { AuthHeaderResult } from "./authHeaders.js";
export { classify } from "./classification.js";
export type { ClassificationInput, ClassificationOutput } from "./classification.js";
export { CONFUSABLES, containsConfusableChar, detectHomoglyphs, extractDomains, isMixedScriptLabel } from "./homoglyph.js";
export { detectNewIban, extractIbans } from "./ibanDetection.js";
export { detectLinkMismatch, extractLinks } from "./linkMismatch.js";
export type { ExtractedLink } from "./linkMismatch.js";
export { scoreUrgencyLanguage } from "./urgencyLanguage.js";
