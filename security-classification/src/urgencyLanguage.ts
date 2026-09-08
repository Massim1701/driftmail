// ============================================================================
// PLATZHALTER-HEURISTIK -- hier gehört später echte KI/NLP hin.
//
// Reines Keyword-Zählen erkennt weder Umschreibungen ("Wir bitten Sie, das
// zeitnah zu klären, sonst müssen wir Maßnahmen ergreifen") noch Tonfall,
// Imperativ-Häufung oder Drohszenarien, die nicht auf dieser Liste stehen.
// Produktionsversion: Text durch den on-device- oder cloud-fallback-KI-
// Adapter (siehe contracts/ai-adapter-interface.ts, AiSource) schicken und
// ein echtes Sprachmodell den Score bestimmen lassen. Diese Funktion ist nur
// ein deterministischer Platzhalter, damit die Pipeline von Anfang an
// end-to-end lauffähig und testbar ist.
// ============================================================================

const URGENCY_KEYWORDS_DE = [
  "dringend",
  "sofort",
  "sofortige",
  "umgehend",
  "unverzüglich",
  "letzte warnung",
  "letzte mahnung",
  "konto gesperrt",
  "konto wird gesperrt",
  "wird gesperrt",
  "verifizieren sie",
  "bestätigen sie sofort",
  "handeln sie jetzt",
  "innerhalb von 24 stunden",
  "innerhalb von 48 stunden",
  "andernfalls",
  "sonst wird",
  "gesperrt werden",
  "unerlaubter zugriff",
  "verdächtige aktivität",
  "ihr konto wurde",
];

const URGENCY_KEYWORDS_EN = [
  "urgent",
  "immediately",
  "act now",
  "verify your account",
  "account suspended",
  "account will be suspended",
  "final warning",
  "final notice",
  "within 24 hours",
  "within 48 hours",
  "unauthorized access",
  "suspicious activity",
  "click here now",
  "limited time",
  "expires today",
  "confirm your identity",
];

const ALL_KEYWORDS = [...URGENCY_KEYWORDS_DE, ...URGENCY_KEYWORDS_EN];

/**
 * Heuristischer Score 0.0-1.0 für Dringlichkeitssprache: Keyword-Treffer
 * plus milde Zusatzsignale (Ausrufezeichen-Dichte, GROSSSCHREIBUNG).
 * Gibt anders als domainReputationScore/senderDomainAgeDays nie `null`
 * zurück -- der Score ist aus dem übergebenen Text immer berechenbar
 * (im Zweifel 0), nur seine Aussagekraft ist begrenzt (s.o.).
 */
export function scoreUrgencyLanguage(rawText: string): number {
  const text = rawText.toLowerCase();

  let hits = 0;
  for (const kw of ALL_KEYWORDS) {
    if (text.includes(kw)) hits++;
  }

  const exclamations = (rawText.match(/!/g) ?? []).length;
  const capsWords = (rawText.match(/\b[A-ZÄÖÜ]{4,}\b/g) ?? []).length;

  const rawScore = hits * 0.2 + Math.min(exclamations, 5) * 0.03 + Math.min(capsWords, 5) * 0.02;
  return Math.round(Math.max(0, Math.min(1, rawScore)) * 100) / 100;
}
