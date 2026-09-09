// ============================================================================
// PLATZHALTER-HEURISTIK -- analog zu urgencyLanguage.ts/spamSubcategory.ts.
//
// Reines Keyword-Zählen erkennt weder Umschreibungen ("Wir benötigen eine
// kurze Bestätigung Ihrer Zugangsdaten") noch Schreibvarianten. Nur relevant
// als EIN Baustein von zwei für `blocked` in draftPhishingCheck.ts (siehe
// dort für die konservative Schwelle) -- diese Funktion allein löst nie
// einen Block aus, erst kombiniert mit hoher Dringlichkeits-Sprache
// (urgencyLanguage.ts). Produktionsversion: durch echtes NLP/den
// KI-Adapter ersetzen (contracts/ai-adapter-interface.ts, AiSource).
// ============================================================================

const CREDENTIAL_REQUEST_KEYWORDS_DE = [
  "passwort bestätigen",
  "passwort bestaetigen",
  "passwort eingeben",
  "zugangsdaten eingeben",
  "zugangsdaten bestätigen",
  "zugangsdaten bestaetigen",
  "anmeldedaten eingeben",
  "anmeldedaten bestätigen",
  "konto verifizieren",
  "konto bestätigen",
  "konto bestaetigen",
  "pin eingeben",
  "tan eingeben",
  "kreditkartendaten eingeben",
  "kreditkartennummer eingeben",
  "kartennummer eingeben",
  "iban bestätigen",
  "iban bestaetigen",
  "bankdaten aktualisieren",
  "bankdaten bestätigen",
  "zahlungsdaten aktualisieren",
  "zahlungsdaten bestätigen",
  "zahlungsinformationen aktualisieren",
];

const CREDENTIAL_REQUEST_KEYWORDS_EN = [
  "confirm your password",
  "verify your password",
  "enter your password",
  "enter your credentials",
  "confirm your credentials",
  "verify your account",
  "confirm your account",
  "enter your pin",
  "enter your card number",
  "confirm your card details",
  "update your payment details",
  "confirm your payment details",
  "update your billing information",
  "verify your identity",
];

const ALL_KEYWORDS = [...CREDENTIAL_REQUEST_KEYWORDS_DE, ...CREDENTIAL_REQUEST_KEYWORDS_EN];

/**
 * Erkennt, ob der Text eine explizite Aufforderung enthält,
 * Zugangsdaten (Passwort/PIN/TAN) oder Zahlungsdaten (IBAN/Kreditkarte)
 * preiszugeben oder zu "bestätigen"/"verifizieren". Reines
 * Keyword-Matching, siehe Kommentar oben.
 */
export function detectsCredentialOrPaymentRequest(rawText: string): boolean {
  const text = rawText.toLowerCase();
  return ALL_KEYWORDS.some((kw) => text.includes(kw));
}
