import type { AuthStatus, Classification } from "./types.js";

export interface ClassificationInput {
  spfStatus: AuthStatus;
  dkimStatus: AuthStatus;
  dmarcStatus: AuthStatus;
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number;
  containsNewIban: boolean;
}

export interface ClassificationOutput {
  classification: Classification;
  confidenceScore: number;
}

// ============================================================================
// PLATZHALTER: regelbasierter Scorer statt echter Klassifikation.
//
// Das ist reine Handarbeit mit fest verdrahteten Gewichten -- kein Lernen
// aus Daten, keine Kalibrierung gegen echte Phishing/Spam/Safe-Beispiele.
// Produktionsversion: alle Rohsignale (inkl. rawText) an den on-device-
// oder cloud-fallback-KI-Adapter übergeben und dort klassifizieren lassen
// (contracts/ai-adapter-interface.ts, AiSource-Unterscheidung). Diese
// Funktion existiert, damit analyzeMail() von Anfang an ein vollständiges,
// testbares SecurityResult liefert statt hartcodierter Platzhalterwerte.
// ============================================================================
export function classify(input: ClassificationInput): ClassificationOutput {
  let phishingScore = 0;

  const anyAuthFail =
    input.spfStatus === "fail" || input.dkimStatus === "fail" || input.dmarcStatus === "fail";
  if (anyAuthFail) phishingScore += 0.3;

  if (input.homoglyphDetected) phishingScore += 0.35;
  if (input.linkMismatchDetected) phishingScore += 0.35;

  if (input.urgencyLanguageScore > 0.5) {
    phishingScore += 0.2 * input.urgencyLanguageScore;
  }

  // Eine neue IBAN allein ist kein Alarmsignal (z.B. eine legitime neue
  // Rechnung) -- erst in Kombination mit Dringlichkeit oder einem
  // verdächtigen Link wird sie zum Phishing-Indikator ("dringend Ihre
  // Zahlungsdaten aktualisieren").
  if (input.containsNewIban && (input.urgencyLanguageScore > 0.3 || input.linkMismatchDetected)) {
    phishingScore += 0.25;
  }

  const allAuthPass =
    input.spfStatus === "pass" && input.dkimStatus === "pass" && input.dmarcStatus === "pass";
  const noOtherSignals =
    !input.homoglyphDetected &&
    !input.linkMismatchDetected &&
    !input.containsNewIban &&
    input.urgencyLanguageScore < 0.2;

  let classification: Classification;
  if (phishingScore >= 0.5) {
    classification = "phishing";
  } else if (phishingScore >= 0.25) {
    classification = "spam";
  } else if (allAuthPass && noOtherSignals) {
    classification = "safe";
  } else {
    // Weder klar sicher (Auth pass + keine Signale) noch genug Signale für
    // spam/phishing -- z.B. Auth-Header fehlen komplett (spf/dkim/dmarc
    // alle "none", was bei IMAP-Weiterleitungen oder manchen Testfällen
    // vorkommt), ohne weitere Verdachtsmomente.
    classification = "unclear";
  }

  const confidenceScore =
    classification === "unclear" ? 0.4 : Math.min(0.95, 0.5 + phishingScore);

  return {
    classification,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
  };
}
