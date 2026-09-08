// Spiegelt contracts/ai-adapter-interface.ts 1:1. Nicht eigenständig ändern —
// Änderungen am Interface laufen über Track 0 (contracts/ai-adapter-interface.ts).
// Diese Datei importiert bewusst nicht direkt aus contracts/, damit backend/
// als eigenständiges npm-Package ohne Pfad-Abhängigkeit außerhalb von
// backend/ baubar bleibt (siehe README "Annahmen").

export type Classification = "safe" | "spam" | "phishing" | "unclear";
export type AiSource = "on_device" | "cloud_fallback";

export interface SecurityResult {
  spfStatus: "pass" | "fail" | "none";
  dkimStatus: "pass" | "fail" | "none";
  dmarcStatus: "pass" | "fail" | "none";
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null;
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  classification: Classification;
  // Nur gesetzt wenn classification === "spam". "adult"/"gambling" loesen
  // sofortiges Loeschen aus (kein Quarantaene-Pfad, kein 30-Tage-Aufheben,
  // kein Undo) -- siehe WEB_INBOX.md 08.09. Betrifft NICHT "phishing".
  spamSubcategory: "adult" | "gambling" | "generic" | "marketing" | null;
  // Botnetz-Erkennung (WEB_INBOX.md 08.09., contracts/ai-adapter-interface.ts
  // nachgezogen). ipReputationFlag braucht einen externen Blocklist-Abgleich
  // (z.B. Spamhaus XBL/CBL) -- der Mock-Adapter kann das nicht echt prüfen,
  // siehe mockAdapter.ts.
  ipReputationFlag: "clean" | "known_botnet" | "unknown" | null;
  heloMismatch: boolean;
  imageToTextRatio: number | null;
  confidenceScore: number;
}

export interface ContractData {
  providerName: string;
  contractStart: string | null;
  contractEnd: string | null;
  cancellationDeadline: string | null;
  cancellationPeriodDays: number | null;
  extractedConfidence: number;
}

export interface MailSummary {
  summaryText: string;
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null;
}

export interface MailThread {
  messages: Array<{
    fromAddress: string;
    subject: string;
    bodyText: string;
    receivedAt: string;
  }>;
}

export interface AiAdapter {
  analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult>;
  extractContract(rawText: string): Promise<ContractData | null>;
  summarize(rawText: string): Promise<MailSummary>;
  draftReply(thread: MailThread): Promise<string>;
}

export interface AiAdapterResult<T> {
  data: T;
  source: AiSource;
}
