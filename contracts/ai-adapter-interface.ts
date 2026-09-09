// driftmail — AI Adapter Interface (Track 0 Contract)
//
// Jede Plattform (iOS/Swift, Android/Kotlin, Windows/C#, Web/Backend-Fallback)
// implementiert dieses Interface mit eigenem Code. Das Interface selbst
// (Funktionsnamen, Input/Output-Form) ändert sich nur über Track 0.
//
// Track B, D, E implementieren die Logik hinter diesen Funktionen
// plattformunabhängig (Backend/Fallback-Pfad). Track C implementiert
// dasselbe Interface nativ in Swift für On-Device-Ausführung.

export type Classification = "safe" | "spam" | "phishing" | "unclear";
export type AiSource = "on_device" | "cloud_fallback";

export interface SecurityResult {
  spfStatus: "pass" | "fail" | "none";
  dkimStatus: "pass" | "fail" | "none";
  dmarcStatus: "pass" | "fail" | "none";
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null; // 0.0 - 1.0
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null; // 0.0 - 1.0
  containsNewIban: boolean;
  classification: Classification;
  // Nur gesetzt wenn classification === "spam". "adult"/"gambling" loesen
  // sofortiges Loeschen aus (kein Quarantaene-Pfad, kein 30-Tage-Aufheben,
  // kein Undo) -- siehe WEB_INBOX.md 08.09. Betrifft NICHT "phishing".
  spamSubcategory: "adult" | "gambling" | "generic" | "marketing" | null;
  // Botnetz-Erkennung (WEB_INBOX.md 08.09.). ipReputationFlag braucht einen
  // externen Blocklist-Abgleich -- ein zustandsloses Text+Header-Modul kann
  // das nicht selbst liefern (offene Frage, analog domainReputationScore).
  ipReputationFlag: "clean" | "known_botnet" | "unknown" | null;
  heloMismatch: boolean;
  imageToTextRatio: number | null; // 0.0 - 1.0
  confidenceScore: number; // 0.0 - 1.0
}

// Gemeinsamer Schwellwert fuer "niedrige Konfidenz" (TERMINAL_INBOX.md 08.09.,
// Punkt 5): unterhalb dieses Werts zeigt die UI einen Review-Schritt statt die
// extrahierten Daten direkt zu uebernehmen. Gilt fuer ContractData.extractedConfidence
// und SecurityResult.confidenceScore gleichermassen -- ein Wert statt getrennter
// Schwellen pro Feld, damit C/D/F nicht unabhaengig voneinander unterschiedliche
// Werte annehmen. War zuvor nur lokal in Track D als 0.6 angenommen.
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface ContractData {
  providerName: string;
  contractStart: string | null; // ISO date
  contractEnd: string | null; // ISO date
  cancellationDeadline: string | null; // ISO date
  cancellationPeriodDays: number | null;
  extractedConfidence: number; // 0.0 - 1.0, niedrig -> User muss bestätigen (siehe LOW_CONFIDENCE_THRESHOLD)
}

export interface MailSummary {
  summaryText: string; // "Worum geht es" - 1 Satz
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null; // ISO date
}

export interface MailThread {
  messages: Array<{
    fromAddress: string;
    subject: string;
    bodyText: string;
    receivedAt: string; // ISO datetime
  }>;
}

// ===== Das eigentliche Interface =====
// Jede Implementierung (Swift/Kotlin/C#/Backend-TS) bildet diese vier
// Funktionen nach, mit identischer Input/Output-Semantik.

export interface AiAdapter {
  /**
   * Analysiert eine Mail auf Spam/Phishing-Signale.
   * Läuft bevorzugt on-device (iOS/Android/Windows), sonst Cloud-Fallback.
   */
  analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult>;

  /**
   * Extrahiert Vertragsdaten aus Mail-Inhalt (Text oder Anhang-Text).
   * Niedrige extractedConfidence -> UI zeigt Review-Schritt.
   */
  extractContract(rawText: string): Promise<ContractData | null>;

  /**
   * Fasst zusammen, was der Absender will und was zu tun ist.
   * Wird on-demand per User-Klick ausgelöst ("Was wollen die von mir?").
   */
  summarize(rawText: string): Promise<MailSummary>;

  /**
   * Generiert einen Antwortentwurf basierend auf dem Thread-Kontext.
   * Ergebnis geht nie automatisch raus, immer Review/Edit/Send durch User.
   * Liefert AiAdapterResult<string> (nicht nur den Text) analog zu
   * message_ai_summary.source, da die Quelle (on_device/cloud_fallback)
   * auch für Antwortentwürfe nachvollziehbar sein muss.
   */
  draftReply(thread: MailThread): Promise<AiAdapterResult<string>>;
}

// ===== Herkunfts-Tag für jede KI-Ausgabe =====
// Jede konkrete Implementierung muss ihre Quelle mitliefern, damit
// message_ai_summary.source korrekt befüllt werden kann.
export interface AiAdapterResult<T> {
  data: T;
  source: AiSource;
}
