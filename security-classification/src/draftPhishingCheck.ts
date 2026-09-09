import { extractCreditCardNumbers } from "./creditCardDetection.js";
import { detectsCredentialOrPaymentRequest } from "./credentialRequestLanguage.js";
import { extractDomains, isHomoglyphDomain } from "./homoglyph.js";
import { extractIbans } from "./ibanDetection.js";
import { isLinkMismatch, type ExtractedLink } from "./linkMismatch.js";
import { scoreUrgencyLanguage } from "./urgencyLanguage.js";

// Spiegelt den Response-Body von `POST /messages/draft/phishing-check` aus
// contracts/api-spec.yaml (WEB_INBOX.md 08.09., "Ausgehender Phishing-Check
// im Composer"). Dieselbe Sync-Pflicht wie bei types.ts/SecurityResult
// gilt hier: bei Contract-Änderungen manuell nachziehen.

export type SensitiveDataKind = "iban" | "credit_card" | "other";

export type RecipientReputation = "safe" | "unknown" | "flagged";

export interface RiskyLink {
  url: string;
  reason: string;
}

export interface DraftPhishingCheckResult {
  blocked: boolean;
  reason: string | null;
  containsSensitiveData: SensitiveDataKind[];
  recipientReputation: RecipientReputation;
  riskyLinks: RiskyLink[];
}

// `blocked` ist ein harter Block (Versand wird verhindert, kein
// "Warnen-und-trotzdem-erlauben", siehe WEB_INBOX.md 08.09.) -- deshalb
// bewusst konservativ: nur Signale, die für sich genommen praktisch nie in
// legitimen Entwürfen vorkommen, lösen `blocked = true` aus. Lieber ein
// false negative (eine Phishing-Mail rutscht durch den Check) als ein false
// positive (eine legitime Mail eines Nutzers wird blockiert) -- letzteres
// wäre ein Produktvertrauensbruch, ersteres ist "nur" ein verpasster Fang,
// den es beim Empfang der Mail beim Empfänger ohnehin noch geben könnte.
//
// Drei Wege zu `blocked = true`:
//
// 1. `isLinkMismatch` auf irgendeinen Link: Anzeigetext behauptet eine
//    Domain, das tatsächliche Ziel ist eine andere. Praktisch nie ein
//    Versehen -- legitime Mails, die einen Link mit Domain-Anzeigetext
//    zeigen, verlinken auch dorthin.
// 2. `isHomoglyphDomain` auf eine Link-Domain (Ziel-URL ODER Anzeigetext):
//    Domain mischt Schriftsysteme oder besteht aus Konfusionszeichen.
//    Kommt in legitimen Domains praktisch nicht vor.
// 3. Dringlichkeits-Sprache (`scoreUrgencyLanguage >= URGENCY_BLOCK_THRESHOLD`)
//    UND eine explizite Zugangsdaten-/Zahlungsdaten-Anfrage
//    (`detectsCredentialOrPaymentRequest`). Absichtlich eine UND-Verknüpfung,
//    nicht ODER: Dringlichkeits-Sprache allein kommt auch in legitimen
//    Mails vor ("bitte dringend bis Freitag antworten"), eine
//    Zugangsdaten-Anfrage allein ebenfalls (ein IT-Support-Mitarbeiter, der
//    intern schreibt "bitte Passwort im Portal bestätigen"). Erst die
//    Kombination ist der klassische Phishing-Move ("Ihr Konto wird
//    gesperrt, bestätigen Sie sofort Ihr Passwort"). Schwelle 0.5 für
//    `urgencyLanguageScore` gewählt, weil `classification.ts` (Empfangsseite)
//    denselben Wert als Schwelle für "relevant genug, um den
//    Phishing-Score überhaupt zu erhöhen" verwendet (`> 0.5` dort) --
//    konsistent zur bestehenden Kalibrierung dieses Moduls, nicht neu
//    erfunden.
const URGENCY_BLOCK_THRESHOLD = 0.5;

function evaluateLink(link: ExtractedLink): RiskyLink | null {
  const reasons: string[] = [];

  if (isLinkMismatch(link)) {
    reasons.push(
      "Anzeigetext täuscht eine andere Domain vor als das tatsächliche Link-Ziel",
    );
  }

  // Homoglyphen können sowohl im tatsächlichen Ziel als auch im
  // (gefälschten) Anzeigetext stecken -- beide werden geprüft, siehe
  // homoglyph.ts.
  const domainsToCheck = [...extractDomains(link.actualUrl), ...extractDomains(link.displayText)];
  if (domainsToCheck.some(isHomoglyphDomain)) {
    reasons.push(
      "Domain enthält Homoglyphen (verwechselbare Zeichen aus einem anderen Schriftsystem)",
    );
  }

  if (reasons.length === 0) return null;
  return { url: link.actualUrl, reason: reasons.join("; ") };
}

/**
 * Implementiert `POST /messages/draft/phishing-check` aus
 * contracts/api-spec.yaml: prüft einen Mail-ENTWURF (bodyText + bereits
 * extrahierte Links) vor dem Versand auf Phishing-Merkmale, bevor die Mail
 * den Composer verlässt. Nutzt dieselbe Erkennungslogik wie `analyzeMail()`
 * für eingehende Mails (Link-Mismatch, Homoglyphen, Dringlichkeitssprache,
 * IBAN-Erkennung), angewendet auf den Entwurf statt auf eine empfangene
 * Mail -- siehe WEB_INBOX.md 08.09. ("Ausgehender Phishing-Check im
 * Composer").
 *
 * Synchron und zustandslos wie der Rest dieses Pakets (kein Netzwerk-/
 * DB-Zugriff) -- anders als `analyzeMail` deshalb kein `Promise`, weil der
 * Contract hier keine async-Signatur vorgibt.
 *
 * `recipientReputation` ist immer `"unknown"` -- siehe Kommentar direkt am
 * Rückgabewert unten und SYNC.md "Offene Fragen".
 */
export function checkDraftForPhishing(
  bodyText: string,
  links: ExtractedLink[],
): DraftPhishingCheckResult {
  const riskyLinks: RiskyLink[] = [];
  let linkMismatchFound = false;
  let homoglyphFound = false;

  for (const link of links) {
    const evaluated = evaluateLink(link);
    if (evaluated) {
      riskyLinks.push(evaluated);
      // Nochmal einzeln auswerten statt aus `evaluated.reason` zu parsen --
      // klarer und robuster als String-Matching auf den (deutschen)
      // Anzeigetext.
      if (isLinkMismatch(link)) linkMismatchFound = true;
      const domains = [...extractDomains(link.actualUrl), ...extractDomains(link.displayText)];
      if (domains.some(isHomoglyphDomain)) homoglyphFound = true;
    }
  }

  const urgencyScore = scoreUrgencyLanguage(bodyText);
  const credentialRequestFound = detectsCredentialOrPaymentRequest(bodyText);
  const urgencyPlusCredentialRequest =
    urgencyScore >= URGENCY_BLOCK_THRESHOLD && credentialRequestFound;

  const blocked = linkMismatchFound || homoglyphFound || urgencyPlusCredentialRequest;

  let reason: string | null = null;
  if (blocked) {
    const parts: string[] = [];
    if (linkMismatchFound) {
      parts.push("Link mit abweichendem Anzeigetext (Anzeige- vs. tatsächliche Ziel-Domain)");
    }
    if (homoglyphFound) {
      parts.push("Homoglyph-Domain in einem Link erkannt");
    }
    if (urgencyPlusCredentialRequest) {
      parts.push(
        "Dringlichkeits-Sprache kombiniert mit einer Zugangs- oder Zahlungsdaten-Anfrage",
      );
    }
    reason = parts.join("; ");
  }

  // NICHT blockierend, siehe Contract-Kommentar in api-spec.yaml und
  // WEB_INBOX.md 08.09.: eigene sensible Daten mitzuteilen ist nicht per se
  // falsch (z.B. eigene IBAN für eine Überweisung nennen). Nur ein
  // Warnhinweis für den Nutzer, unabhängig vom `blocked`-Ergebnis oben.
  const containsSensitiveData: SensitiveDataKind[] = [];
  if (extractIbans(bodyText).length > 0) containsSensitiveData.push("iban");
  if (extractCreditCardNumbers(bodyText).length > 0) containsSensitiveData.push("credit_card");
  // "other" (z.B. Sozialversicherungsnummer-Muster) bewusst nicht
  // implementiert -- kein einheitliches, leicht validierbares Format wie
  // bei IBAN (Mod-97) oder Kreditkarte (Luhn) über Länder hinweg, ein
  // Keyword-/Regex-Rateversuch ohne Prüfsumme wäre hier deutlich
  // fehleranfälliger als die beiden anderen. Siehe README.md.

  return {
    blocked,
    reason,
    containsSensitiveData,
    // `security-classification/` ist laut Auftrag zustandslos (nur
    // bodyText + links rein, kein DB-/Netzwerkzugriff) und kann
    // Empfänger-Reputation daher NICHT ehrlich befüllen -- das bräuchte
    // einen Abgleich gegen `fraud_alerts`/Empfänger-Historie in der DB.
    // Immer `"unknown"`, nie geraten (analog zu `ipReputationFlag` in
    // ipReputation.ts). Offene Frage dazu in SYNC.md "Offene Fragen"
    // (wer macht den Lookup -- vermutlich Track A nach diesem Aufruf, da
    // das Backend DB-Zugriff hat).
    recipientReputation: "unknown",
    riskyLinks,
  };
}

export type { ExtractedLink } from "./linkMismatch.js";
