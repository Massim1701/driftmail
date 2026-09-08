// Mock-Implementierung für POST /messages/draft/phishing-check
// (contracts/api-spec.yaml, WEB_INBOX.md 08.09. "Ausgehender Phishing-Check
// im Composer" + Erweiterung "sensible Daten/Empfänger-Reputation/riskante
// Links").
//
// WICHTIG (gleiches Muster wie ai/mockAdapter.ts): Track B
// (security-classification/, Branch track-b-security) hat die ECHTE
// Erkennungslogik dafür bereits gebaut
// (security-classification/src/draftPhishingCheck.ts,
// checkDraftForPhishing()) -- inkl. Homoglyph-Domain-Erkennung, Mod-97
// validierten IBANs, Luhn-validierten Kreditkartennummern und einer
// Dringlichkeits-Sprache-Bewertung. Track A und Track B sind aktuell noch
// getrennte npm-Packages ohne formale Abhängigkeit (backend/ hat keine
// Dependency auf security-classification/). Diese Datei ist deshalb eine
// bewusst simple, ehrliche Mock-Implementierung nach demselben
// Grundprinzip wie Track B (Link-Mismatch, Zugangsdaten-Erkennung, IBAN),
// aber ohne dessen Prüfsummen-/Homoglyph-Feinheiten -- NICHT echte
// Phishing-Erkennung. Die echte Integration (dieses Modul durch einen
// Aufruf von Track B's checkDraftForPhishing ersetzen, z.B. über eine
// Workspace-Dependency oder einen internen HTTP-Call) ist ein separater,
// noch nicht gestarteter Integrations-Schritt (siehe SYNC.md "Offene
// Fragen" und README.md).

import type {
  ApiDraftPhishingCheckLink,
  ApiDraftPhishingCheckResult,
  ApiRiskyLink,
  RecipientReputation,
  SensitiveDataKind,
} from "../types";

// Simple Regex-Kandidaten, KEINE Prüfsumme (kein Mod-97 für IBAN, kein Luhn
// für Kreditkarten) -- anders als Track B's ibanDetection.ts/
// creditCardDetection.ts. "Simple Regex reicht" für diesen Mock (Auftrag),
// erkauft sich damit mehr false positives/negatives als die echte
// Implementierung. Für den Integrations-Schritt durch Track B ersetzen.
const IBAN_REGEX = /\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{1,4}){2,7}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]?){12,18}\d\b/g;

// Dieselbe Grund-Idee wie mockAdapter.ts (PHISHING_KEYWORDS): einfache
// Keyword-Heuristik statt echter Dringlichkeits-Sprache-Bewertung. Blockiert
// nur, wenn BEIDE Listen treffen (Dringlichkeit UND Zugangs-/Zahlungsdaten-
// Anfrage), analog zur UND-Verknüpfung in Track B's draftPhishingCheck.ts --
// eine einzelne Dringlichkeitsformulierung oder eine einzelne
// Zugangsdaten-Erwähnung kommt auch in legitimen Mails vor.
const URGENCY_KEYWORDS = ["dringend", "sofort", "innerhalb von 24 stunden", "konto wird gesperrt", "letzte mahnung"];
const CREDENTIAL_REQUEST_KEYWORDS = ["passwort bestätigen", "passwort eingeben", "iban bestätigen", "zahlungsdaten aktualisieren", "kreditkartendaten"];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Simple Domain-Extraktion aus einer URL (kein Homoglyph-Check, anders als
 * Track B's homoglyph.ts). Gibt null zurück, wenn keine gültige URL/kein
 * domain-artiger String erkennbar ist. */
function extractDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(normalized);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Simple Link-Mismatch-Heuristik: der Anzeigetext behauptet eine Domain
 * (sieht selbst wie eine URL/Domain aus), aber das tatsächliche Link-Ziel
 * zeigt auf eine andere Domain. Klassisches Phishing-Muster. Keine
 * Subdomain-Sonderbehandlung wie bei Track B -- bewusst simpler, siehe
 * Datei-Kommentar oben. */
function evaluateLink(link: ApiDraftPhishingCheckLink): ApiRiskyLink | null {
  const actualDomain = extractDomain(link.actualUrl);
  const displayDomain = link.displayText ? extractDomain(link.displayText) : null;
  if (!actualDomain || !displayDomain) return null;
  if (actualDomain === displayDomain) return null;

  return {
    url: link.actualUrl,
    reason: `Anzeigetext deutet auf "${displayDomain}", tatsächliches Ziel ist aber "${actualDomain}"`,
  };
}

/**
 * Mock-Implementierung von `POST /messages/draft/phishing-check`. Siehe
 * Datei-Kommentar oben: einfache, ehrliche Heuristik nach demselben
 * Grundprinzip wie Track B, NICHT echte Phishing-Erkennung.
 */
export function checkDraftForPhishingMock(
  bodyText: string,
  links: ApiDraftPhishingCheckLink[],
): ApiDraftPhishingCheckResult {
  const riskyLinks: ApiRiskyLink[] = [];
  let linkMismatchFound = false;
  for (const link of links) {
    const evaluated = evaluateLink(link);
    if (evaluated) {
      riskyLinks.push(evaluated);
      linkMismatchFound = true;
    }
  }

  const urgencyAndCredentialRequest = containsAny(bodyText, URGENCY_KEYWORDS) && containsAny(bodyText, CREDENTIAL_REQUEST_KEYWORDS);

  const blocked = linkMismatchFound || urgencyAndCredentialRequest;

  let reason: string | null = null;
  if (blocked) {
    const parts: string[] = [];
    if (linkMismatchFound) parts.push("Link mit abweichendem Anzeigetext (Anzeige- vs. tatsächliche Ziel-Domain)");
    if (urgencyAndCredentialRequest) parts.push("Dringlichkeits-Sprache kombiniert mit einer Zugangs- oder Zahlungsdaten-Anfrage");
    reason = parts.join("; ");
  }

  // NICHT blockierend (siehe api-spec.yaml-Kommentar + WEB_INBOX.md 08.09.):
  // eigene sensible Daten mitzuteilen ist nicht per se falsch (z.B. eigene
  // IBAN für eine Überweisung). Nur ein Warnhinweis, unabhängig von
  // `blocked`.
  // `.match()` statt `.test()`, weil beide Regexe (module-scoped, `g`-Flag)
  // sonst über `lastIndex` einen statefulen Bug hätten (aufeinanderfolgende
  // `.test()`-Aufrufe auf demselben globalen Regex-Objekt liefern
  // abwechselnd true/false für denselben Text) -- `.match()` setzt
  // `lastIndex` pro Aufruf zurück.
  const containsSensitiveData: SensitiveDataKind[] = [];
  if (bodyText.toUpperCase().match(IBAN_REGEX)) containsSensitiveData.push("iban");
  if (bodyText.match(CREDIT_CARD_REGEX)) containsSensitiveData.push("credit_card");
  // "other" (z.B. Sozialversicherungsnummer) bewusst nicht implementiert --
  // kein einheitliches, einfach per Regex erkennbares Format über Länder
  // hinweg, siehe Track B's README (dieselbe Begründung).

  // recipientReputation: IMMER "unknown", genau wie bei Track B dokumentiert
  // (security-classification/src/draftPhishingCheck.ts). Dort, weil das
  // Paket zustandslos ist (kein DB-Zugriff). Hier im Backend absichtlich
  // GENAUSO gehalten, obwohl backend/ grundsätzlich DB-Zugriff hätte: die
  // dafür nötige `fraud_alerts`-Tabelle (contracts/db-schema.sql) ist in
  // diesem Skeleton noch nicht modelliert (kein Record-Typ, kein
  // Store-Zugriff) -- ein echter Empfänger-Reputations-Lookup ist wie die
  // Track-B-Integration ein separater, noch offener Schritt (siehe SYNC.md
  // "Offene Fragen").
  const recipientReputation: RecipientReputation = "unknown";

  return { blocked, reason, containsSensitiveData, recipientReputation, riskyLinks };
}
