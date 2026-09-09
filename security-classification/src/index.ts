import { parseAuthHeaders } from "./authHeaders.js";
import { classify } from "./classification.js";
import { detectHeloMismatch } from "./heloMismatch.js";
import { detectHomoglyphs } from "./homoglyph.js";
import { detectNewIban } from "./ibanDetection.js";
import { computeImageToTextRatio } from "./imageToTextRatio.js";
import { detectIpReputation } from "./ipReputation.js";
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
 *    (Track A) sofortiges Löschen ohne Quarantäne auslösen. Seit 09.09.
 *    (SYNC.md, Web-Antwort auf den Track-A+B-Integrationsfund) ist
 *    "adult"/"gambling" ein EIGENSTÄNDIGER Klassifikations-Trigger, nicht
 *    mehr nur eine nachgelagerte Verfeinerung einer bereits anderweitig
 *    erreichten "spam"-Klassifikation -- siehe Kommentar bei
 *    `CONTENT_TRIGGERED_SPAM_CONFIDENCE` unten.
 *  - ipReputationFlag: braucht einen externen Botnetz-Blocklist-Abgleich
 *    (Netzwerkzugriff), bleibt hier immer `"unknown"` (siehe
 *    ipReputation.ts).
 *  - heloMismatch: nur eine grobe String-Heuristik ohne echten
 *    Reverse-DNS-Abgleich (siehe heloMismatch.ts).
 *  - imageToTextRatio: echte Berechnung aus HTML (`<img>`-Tags vs.
 *    sichtbarer Textmenge), aber `null` ohne erkennbares HTML (siehe
 *    imageToTextRatio.ts).
 */

// Konfidenz für classification="spam", wenn sie NICHT über classify()'s
// phishing-Score-Signale erreicht wird, sondern allein über einen
// eindeutigen adult/gambling-Inhaltstreffer (siehe Aufruf unten). Fixer
// Platzhalterwert wie der Rest dieses Moduls (kein ML) -- detectSpamSubcategory()
// liefert selbst keinen Konfidenzwert, nur eine binäre STRONG/WEAK-Schwelle
// (siehe spamSubcategory.ts), daher hier eine einzelne Zahl statt einer
// Formel. 0.75 gewählt: klar über der 0.5-"nur Vermutung"-Grenze der
// phishing-Score-Formel, aber unter dem, was ein tatsächliches
// Phishing-Signal (>= 0.85 typischerweise) erreicht -- ein reiner
// Content-Treffer ohne technisches Signal ist etwas weniger sicher als
// Auth-Fail/Homoglyph/Link-Mismatch.
const CONTENT_TRIGGERED_SPAM_CONFIDENCE = 0.75;

export async function analyzeMail(
  rawText: string,
  headers: Record<string, string>,
): Promise<SecurityResult> {
  const { spfStatus, dkimStatus, dmarcStatus } = parseAuthHeaders(headers);
  const homoglyphDetected = detectHomoglyphs(rawText, headers);
  const linkMismatchDetected = detectLinkMismatch(rawText);
  const urgencyLanguageScore = scoreUrgencyLanguage(rawText);
  const containsNewIban = detectNewIban(rawText);
  const heloMismatch = detectHeloMismatch(headers);
  const imageToTextRatio = computeImageToTextRatio(rawText);
  const ipReputationFlag = detectIpReputation();

  const { classification: signalClassification, confidenceScore: signalConfidence } = classify({
    spfStatus,
    dkimStatus,
    dmarcStatus,
    homoglyphDetected,
    linkMismatchDetected,
    urgencyLanguageScore,
    containsNewIban,
  });

  // Eigenständiger Klassifikations-Trigger (SYNC.md 09.09., Web-Antwort auf
  // den Track-A+B-Integrationsfund): eindeutiger adult/gambling-Inhalt hebt
  // classification auf "spam", AUCH wenn sonst keine phishing-artigen
  // Signale (Auth-Fail/Homoglyph/Link-Mismatch/Dringlichkeit) vorliegen --
  // der Hauptfall, für den die spamSubcategory-Regel ursprünglich gebaut
  // wurde (Sex-/Glücksspiel-Werbemails sind technisch meist "sauber").
  // "phishing" bleibt unangetastet (stärkeres, spezifischeres Signal geht
  // vor) -- ein zufälliger Content-Treffer soll ein echtes Phishing-Ergebnis
  // nicht herabstufen. generic/marketing lösen weiterhin KEINEN eigenen
  // Trigger aus (unverändert nachgelagert), da nur adult/gambling die
  // zeitkritische Auto-Delete-Kategorie ist (siehe WEB_INBOX.md 08.09.).
  const contentSpamSubcategory = detectSpamSubcategory(rawText);
  const contentTriggersSpam =
    signalClassification !== "phishing" &&
    (contentSpamSubcategory === "adult" || contentSpamSubcategory === "gambling");

  const classification = contentTriggersSpam ? "spam" : signalClassification;
  const confidenceScore = contentTriggersSpam ? CONTENT_TRIGGERED_SPAM_CONFIDENCE : signalConfidence;

  // Hart aus dem Contract: NUR bei classification === "spam" gesetzt, sonst
  // immer null -- explizit auch bei "phishing" (siehe types.ts-Kommentar
  // und WEB_INBOX.md 08.09.). `contentSpamSubcategory` oben bereits
  // berechnet -- bei classification "spam" über den bisherigen
  // signal-basierten Pfad ist das derselbe Aufruf wie vorher (rawText
  // ändert sich zwischen beiden Aufrufen nicht, reiner Namens-Alias).
  const spamSubcategory = classification === "spam" ? contentSpamSubcategory : null;

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
    ipReputationFlag,
    heloMismatch,
    imageToTextRatio,
    confidenceScore,
  };
}

export type { AuthStatus, Classification, IpReputationFlag, SecurityResult, SpamSubcategory } from "./types.js";
export { parseAuthHeaders } from "./authHeaders.js";
export type { AuthHeaderResult } from "./authHeaders.js";
export { classify } from "./classification.js";
export type { ClassificationInput, ClassificationOutput } from "./classification.js";
export { extractCreditCardNumbers, detectCreditCard } from "./creditCardDetection.js";
export { detectsCredentialOrPaymentRequest } from "./credentialRequestLanguage.js";
export { checkDraftForPhishing } from "./draftPhishingCheck.js";
export type { DraftPhishingCheckResult, RiskyLink, SensitiveDataKind, RecipientReputation } from "./draftPhishingCheck.js";
export { detectHeloMismatch } from "./heloMismatch.js";
export { CONFUSABLES, containsConfusableChar, detectHomoglyphs, extractDomains, isHomoglyphDomain, isMixedScriptLabel } from "./homoglyph.js";
export { detectNewIban, extractIbans } from "./ibanDetection.js";
export { computeImageToTextRatio } from "./imageToTextRatio.js";
export { detectIpReputation } from "./ipReputation.js";
export { detectLinkMismatch, extractLinks, isLinkMismatch } from "./linkMismatch.js";
export type { ExtractedLink } from "./linkMismatch.js";
export { detectSpamSubcategory } from "./spamSubcategory.js";
export { scoreUrgencyLanguage } from "./urgencyLanguage.js";
