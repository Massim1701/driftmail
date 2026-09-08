// Track D — extractContract(rawText)
//
// Implementiert die extractContract-Funktion aus dem Track-0-Contract
// (contracts/ai-adapter-interface.ts, Interface AiAdapter.extractContract).
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ WICHTIG — erster Durchstich, KEINE echte KI-Extraktion.                │
// │ Diese Implementierung ist regelbasiert/heuristisch (Regex auf         │
// │ deutsch-/englischsprachige Vertrags-Mails: Datumsformate,             │
// │ Firmenrechtsform-Suffixe, typische Signalwörter). Sie liefert         │
// │ absichtlich konservative Konfidenz-Scores, damit die UI (Track C/F)   │
// │ im Zweifel einen Review-Schritt zeigt (extractedConfidence niedrig,   │
// │ siehe LOW_CONFIDENCE_THRESHOLD in ./types.ts).                        │
// │                                                                        │
// │ ECHTE KI-EXTRAKTION KÄME HIER REIN: siehe Markierung                  │
// │ "AI EXTRACTION HOOK" weiter unten. Ersatz-Implementierung würde        │
// │ rawText an ein LLM (on-device oder cloud_fallback gemäß               │
// │ AiAdapterResult<T>.source) geben, mit Structured-Output-Schema         │
// │ passend zu ContractData, und die Heuristik hier bestenfalls als       │
// │ Fallback behalten, falls kein KI-Provider verfügbar ist.               │
// └──────────────────────────────────────────────────────────────────────┘

import type { ContractData } from "./types.js";

// ===== Hilfsfunktionen: Datum =====

const MONTH_NAMES_DE: Record<string, number> = {
  januar: 1,
  jänner: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

/** Formatiert Jahr/Monat/Tag als ISO-Datum (YYYY-MM-DD), mit Padding. */
function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = year < 100 ? 2000 + year : year; // "24" -> 2024, grobe Heuristik
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Sucht das erste Datum in einem Textausschnitt und gibt es als ISO-String
 * zurück. Unterstützt: DD.MM.YYYY, DD.MM.YY, YYYY-MM-DD, "1. Januar 2026".
 */
function findFirstDate(text: string): string | null {
  // ISO: 2026-09-08
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Deutsch numerisch: 08.09.2026 oder 8.9.26
  const de = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (de) return toIsoDate(Number(de[3]), Number(de[2]), Number(de[1]));

  // Deutsch textuell: "1. Januar 2026" / "15 März 2027"
  const monthPattern = Object.keys(MONTH_NAMES_DE).join("|");
  const deText = new RegExp(`\\b(\\d{1,2})\\.?\\s*(${monthPattern})\\s*(\\d{4})\\b`, "i").exec(
    text
  );
  if (deText) {
    const month = MONTH_NAMES_DE[deText[2].toLowerCase()];
    return toIsoDate(Number(deText[3]), month, Number(deText[1]));
  }

  return null;
}

/** Findet das erste Datum nach einem der gegebenen Label-Regexe (innerhalb der nächsten ~60 Zeichen). */
function findDateAfterLabels(text: string, labels: RegExp[]): string | null {
  for (const label of labels) {
    const match = label.exec(text);
    if (!match) continue;
    const windowStart = match.index + match[0].length;
    const window = text.slice(windowStart, windowStart + 60);
    const date = findFirstDate(window);
    if (date) return date;
  }
  return null;
}

// ===== Hilfsfunktionen: Kündigungsfrist in Tagen =====

/** Extrahiert eine Kündigungsfrist in Tagen aus Formulierungen wie "3 Monate", "30 Tage", "6 Wochen". */
function findCancellationPeriodDays(text: string): number | null {
  const pattern =
    /(?:Kündigungsfrist|kündbar|Frist von)\D{0,20}?(\d{1,3})\s*(Tag|Tage|Woche|Wochen|Monat|Monate|Monaten)/i;
  const match = pattern.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("tag")) return amount;
  if (unit.startsWith("woche")) return amount * 7;
  if (unit.startsWith("monat")) return amount * 30;
  return null;
}

// ===== Hilfsfunktionen: Anbietername =====

const PROVIDER_LABEL_PATTERN =
  /(?:Anbieter|Vertragspartner|Dienstleister|Unternehmen)\s*[:\-]\s*([^\n,;]{2,60})/i;

// Gängige Rechtsformen als Suffix (deutsch + international)
const LEGAL_SUFFIX_PATTERN =
  /\b([A-ZÄÖÜ][\wÄÖÜäöüß.& -]{1,50}?\s(?:GmbH\s?&\s?Co\.?\s?KG|GmbH|mbH|AG|SE|KG|OHG|e\.V\.|Ltd\.?|Inc\.?|LLC|Co\.))\b/;

const SIGNATURE_PATTERN = /Mit freundlichen Grüßen\s*[\r\n]+([^\r\n]{2,60})/i;

interface ProviderMatch {
  name: string;
  confidenceContribution: number;
}

function findProviderName(text: string): ProviderMatch | null {
  const label = PROVIDER_LABEL_PATTERN.exec(text);
  if (label) {
    return { name: label[1].trim(), confidenceContribution: 0.3 };
  }

  const legalSuffix = LEGAL_SUFFIX_PATTERN.exec(text);
  if (legalSuffix) {
    return { name: legalSuffix[1].trim(), confidenceContribution: 0.2 };
  }

  const signature = SIGNATURE_PATTERN.exec(text);
  if (signature) {
    return { name: signature[1].trim(), confidenceContribution: 0.1 };
  }

  return null;
}

// ===== extractContract =====

const START_LABELS = [
  /Vertragsbeginn/i,
  /Beginn des Vertrags(?:es)?/i,
  /Vertragsstart/i,
  /gültig ab/i,
  /läuft ab/i,
];

const END_LABELS = [
  /Vertragsende/i,
  /Laufzeit bis/i,
  /endet am/i,
  /gültig bis/i,
  /befristet bis/i,
];

const DEADLINE_LABELS = [
  /Kündigungsfrist bis/i,
  /kündbar bis(?:\s*zum)?/i,
  /spätestens kündigen bis/i,
  /Kündigung(?:\s*bis)?\s*zum/i,
  /Widerspruch bis/i,
];

/**
 * Regelbasierte Vertragsdaten-Extraktion aus Mail-Rohtext.
 *
 * Gibt `null` zurück, wenn der Text keinerlei Vertragssignal enthält
 * (keine erkennbare Firma, kein Datum, keine Kündigungsfrist) — dann lohnt
 * sich kein contracts-Datensatz. Sonst wird immer ein ContractData-Objekt
 * geliefert, ggf. mit vielen `null`-Feldern und niedriger
 * extractedConfidence, damit die UI einen Review-Schritt anbieten kann.
 */
export async function extractContract(rawText: string): Promise<ContractData | null> {
  const text = rawText.normalize("NFC");

  // ── AI EXTRACTION HOOK ────────────────────────────────────────────────
  // Hier würde bei einer echten Implementierung zuerst ein KI-Provider
  // (on-device LLM oder cloud_fallback, siehe ai-adapter-interface.ts /
  // AiAdapterResult<T>.source) versucht werden, z.B.:
  //
  //   const aiResult = await callLlmForContractExtraction(text);
  //   if (aiResult) return aiResult;
  //
  // mit einem Structured-Output-Prompt, der exakt das ContractData-Schema
  // zurückgibt. Die Heuristik unten würde dann nur noch als Fallback
  // dienen (kein KI-Provider erreichbar / Quota aufgebraucht, siehe
  // ai_provider_config in db-schema.sql).
  // ────────────────────────────────────────────────────────────────────

  const provider = findProviderName(text);
  const contractStart = findDateAfterLabels(text, START_LABELS);
  const contractEnd = findDateAfterLabels(text, END_LABELS);
  const cancellationDeadline = findDateAfterLabels(text, DEADLINE_LABELS);
  const cancellationPeriodDays = findCancellationPeriodDays(text);

  const hasAnySignal =
    provider !== null ||
    contractStart !== null ||
    contractEnd !== null ||
    cancellationDeadline !== null ||
    cancellationPeriodDays !== null;

  if (!hasAnySignal) {
    return null;
  }

  let confidence = 0.1; // Basis: irgendein Signal gefunden, aber sehr unsicher
  confidence += provider?.confidenceContribution ?? 0;
  if (contractStart) confidence += 0.15;
  if (contractEnd) confidence += 0.15;
  if (cancellationDeadline) confidence += 0.15;
  if (cancellationPeriodDays !== null) confidence += 0.1;
  confidence = Math.min(confidence, 0.95); // 1.0 bleibt echter KI-Extraktion vorbehalten

  return {
    providerName: provider?.name ?? "",
    contractStart,
    contractEnd,
    cancellationDeadline,
    cancellationPeriodDays,
    extractedConfidence: Math.round(confidence * 100) / 100,
  };
}
